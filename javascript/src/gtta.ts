import { Hash, Callback, TransactionsToApprove } from '@iota/core/typings/types';
import { Info, latestMilestone, tails, milestones, areTxsConsistent, txs } from './tangle';
import * as Bluebird from 'bluebird';
import debug from 'debug';

const log = debug('local-gtta');

/**
 * Does the _tip selection_ by calling
 * [`getTransactionsToApprove`](https://docs.iota.works/iri/api#endpoints/getTransactionsToApprove) command.
 * Returns a pair of approved transactions, which are chosen randomly after validating the transaction trytes,
 * the signatures and cross-checking for conflicting transactions.
 *
 * Tip selection is executed by a Random Walk (RW) starting at random point in given `depth`
 * ending up to the pair of selected tips. For more information about tip selection please refer to the
 * [whitepaper](https://iota.org/IOTA_Whitepaper.pdf).
 *
 * The `reference` option allows to select tips in a way that the reference transaction is being approved too.
 * This is useful for promoting transactions, for example with
 * [`promoteTransaction`]{@link #module_core.promoteTransaction}.
 *
 * @example
 *
 * ```js
 * const depth = 3
 * const minWeightMagnitude = 14
 *
 * getTransactionsToApprove(depth)
 *   .then(transactionsToApprove =>
 *      attachToTangle(minWeightMagnitude, trytes, { transactionsToApprove })
 *   )
 *   .then(storeAndBroadcast)
 *   .catch(err => {
 *     // handle errors here
 *   })
 * ```
 *
 * @method getTransactionsToApprove
 *
 * @memberof module:core
 *
 * @param {number} depth - The depth at which Random Walk starts. A value of `3` is typically used by wallets,
 * meaning that RW starts 3 milestones back.
 * @param {Hash} [reference] - Optional reference transaction hash
 * @param {Callback} [callback] - Optional callback
 *
 * @return {Promise}
 * @fulfil {trunkTransaction, branchTransaction} A pair of approved transactions
 * @reject {Error}
 * - `INVALID_DEPTH`
 * - `INVALID_REFERENCE_HASH`: Invalid reference hash
 * - Fetch error
 */
export function getTransactionsToApprove(
  depth: number,
  reference?: Hash,
  callback?: Callback<TransactionsToApprove>,
): Bluebird<TransactionsToApprove> {
  return Bluebird.resolve(getTips(depth, reference))
    .asCallback(typeof arguments[1] === 'function' ? arguments[1] : callback);
}

async function getTips(depth: number, reference?: Hash) {
  const entryMilestone = latestMilestone - depth;
  const milestone = milestones.get(entryMilestone);
  if (milestone && milestone.size > 0) {
    let entries = Array.from(milestone);
    const inconsistentTxs = new Set<Hash>();

    const findTips: () => Promise<{trunkTransaction: Hash, branchTransaction: Hash}> = async () => {
      if (entries.length === 0) {
        throw new Error('No consistent entry points available.');
      }
      const tips =  await Promise.all([randomWalk(entries, depth, inconsistentTxs),
        randomWalk(entries, depth, inconsistentTxs, reference)]);
      if (tips.filter((t) => t).length === 2) {
        if (await areTxsConsistent(...tips.map((t) => t!.hash))) {
          const hashes = tips.map((t) => t!.hash);
          return {trunkTransaction: hashes[0], branchTransaction: hashes[1]};
        } else {
          tips.forEach((t) => inconsistentTxs.add(t!.hash));
          log('Selected tips ar not consistent. Try again.');
          entries = entries.filter((t) => !inconsistentTxs.has(t.hash));
          return await findTips();
        }
      } else {
        throw new Error('No consistent tips could be found.');
      }
    };
    return await findTips();
  } else {
    throw new Error('Tangle with this depth is not present.');
  }
}

async function randomWalk(entries: Info[], depth: number, inconsistentTxs: Set<Hash>, reference?: Hash):
    Promise<Info | undefined> {
  const validEntries = entries.filter((e) => !inconsistentTxs.has(e.hash));
  if (validEntries.length === 0) {
    return undefined;
  } else {
    let entryPoint: Info;
    if (reference) {
      const refTx = txs.get(reference);
      if (refTx) {
        entryPoint = refTx;
      } else {
        throw new Error('Invalid reference');
      }
    } else {
      entryPoint = getEntryPoint(validEntries);
    }

    const {tx, traversed} = await select(entryPoint, inconsistentTxs, (depth + 1) * 4);
    if (tx.approvers === 0) {
      log(`Traversed ${traversed.size} consistent txs for random walk`);
      return tx;
    } else {
      log('Can\'t find consistent tip.');
      return undefined;
    }
  }
}

const alpha = .001;

function getEntryPoint(validEntries: Info[]) {
  const index = Math.round(Math.random() * (validEntries.length - 1));
  return validEntries[index];
}

async function select(entryPoint: Info, inconsistentTxs: Set<Hash>, verifyBatchSize: number) {
  const traversed = new Set<Hash>();

  let tx = entryPoint;
  let lastValid = entryPoint;
  let toVerify: Hash[] = [];
  let approvers = Array.from(tx.directApprovers).filter((e) => !inconsistentTxs.has(e.hash));

  while (approvers.length > 0) {
    traversed.add(tx.hash);
    const ratings = approvers.map((a) => a.approvers + 1);
    const maxRating = Math.max(...ratings);
    const weights = ratings.map((w) => w - maxRating).map((w) => Math.exp(alpha * w));

    const weightSum = weights.reduce((acc, v) => acc + v);
    let target = Math.random() * weightSum;
    let approverIndex: number;
    for (approverIndex = 0; approverIndex < weights.length - 1; approverIndex++) {
        target -= weights[approverIndex];
        if (target <= 0) {
            break;
        }
    }

    const approver = approvers[approverIndex];
    const tail = tails.get(approver.bundle);

    if (tail) {
      tx = tail;
      toVerify.push(tx.hash);
      if (toVerify.length >= verifyBatchSize) {
        if (await areTxsConsistent(...toVerify)) {
          lastValid = tx;
        } else {
          log(`Traversed txs aren\'t consistent. Go back ${verifyBatchSize + 1} steps.`);
          toVerify.forEach((t) => {
            inconsistentTxs.add(t);
            traversed.delete(t);
          });
          inconsistentTxs.add(approver.hash);
          tx = lastValid;
        }
        toVerify = [];
      }
      approvers = Array.from(tx.directApprovers).filter((e) => !inconsistentTxs.has(e.hash));
    } else {
      approvers.splice(approverIndex);
    }
  }
  return {tx, traversed};
}
