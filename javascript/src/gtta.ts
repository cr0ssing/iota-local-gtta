import { Hash } from '@iota/core/typings/types';
import { Info, latestMilestone, tails, milestones, areTxsConsistent } from './tangle';

export async function getTips(depth: number) {
  const entryMilestone = latestMilestone - depth;
  const milestone = milestones.get(entryMilestone);
  if (milestone && milestone.size > 0) {
    let entries = Array.from(milestone);
    const inconsistentTxs = new Set<Hash>();

    const findTips: () => Promise<{trunk: Hash, branch: Hash}> = async () => {
      if (entries.length === 0) {
        throw new Error('No consistent entry points available.');
      }
      const tips =  await Promise.all([randomWalk(entries, depth, inconsistentTxs),
        randomWalk(entries, depth, inconsistentTxs)]);
      if (tips.filter((t) => t).length === 2) {
        if (await areTxsConsistent(...tips.map((t) => t!.hash))) {
          const hashes = tips.map((t) => t!.hash);
          return {trunk: hashes[0], branch: hashes[1]};
        } else {
          tips.forEach((t) => inconsistentTxs.add(t!.hash));
          console.log('Selected tips ar not consistent. Try again.');
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

async function randomWalk(entries: Info[], depth: number, inconsistentTxs = new Set<Hash>()):
    Promise<Info | undefined> {
  const validEntries = entries.filter((e) => !inconsistentTxs.has(e.hash));
  if (validEntries.length === 0) {
    return undefined;
  } else {
    const {tx, traversed} = await select(validEntries, inconsistentTxs, (depth + 1) * 4);
    if (tx.approvers === 0) {
      console.log(`Traversed ${traversed.size} consistent txs for random walk`);
      return tx;
    } else {
      console.log('Can\'t find consistent tip.');
      return undefined;
    }
  }
}

const alpha = .001;

async function select(validEntries: Info[], inconsistentTxs: Set<Hash>, verifyBatchSize: number) {
  const index = Math.round(Math.random() * (validEntries.length - 1));
  const entryPoint = validEntries[index];
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
          console.log(`Traversed txs aren\'t consistent. Go back ${verifyBatchSize + 1} steps.`);
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
