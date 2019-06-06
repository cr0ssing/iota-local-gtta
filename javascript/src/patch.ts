import { API, Settings, composeAPI as composeOrg } from '@iota/core';
import { asTransactionObject } from '@iota/transaction-converter';
import { Trytes, Hash, Bundle, Callback, TransactionsToApprove } from '@iota/core/typings/types';
import * as Promise from 'bluebird';
import { getTransactionsToApprove } from './gtta';
import { availableDepth } from './tangle';
import debug from 'debug';

const log = debug('local-gtta');

export function patchAPI(iota: API) {
  const gtta = iota.getTransactionsToApprove;
  iota.getTransactionsToApprove = (
    depth: number,
    reference?: Hash,
    callback?: Callback<TransactionsToApprove>,
  ) => {
    if (availableDepth >= depth) {
      log('Use local gtta');
      return getTransactionsToApprove(depth, reference, callback);
    } else {
      log('Use remote gtta');
      return gtta(depth, reference, callback);
    }
  };
  iota.sendTrytes = createSendTrytes(iota, iota.getTransactionsToApprove);
}

export const composeAPI = (settings: Partial<Settings> = {}) => {
  const api = composeOrg(settings);
  patchAPI(api);
  return api;
};



function createSendTrytes(iota: API, gtta:
    (depth: number, reference?: Hash, callback?: Callback<TransactionsToApprove>) => Promise<TransactionsToApprove>) {
  return function sendTrytes(
    trytes: ReadonlyArray<Trytes>,
    depth: number,
    minWeightMagnitude: number,
    reference?: Hash,
    callback?: Callback<Bundle>,
  ): Promise<Bundle> {
    if (reference && typeof reference === 'function') {
        callback = reference;
        reference = undefined;
    }
    return gtta(depth, reference)
        .then(({ trunkTransaction, branchTransaction }) =>
            iota.attachToTangle(trunkTransaction, branchTransaction, minWeightMagnitude, trytes),
        )
        .then((attachedTrytes) => iota.storeAndBroadcast(attachedTrytes))
        .then((attachedTrytes) => attachedTrytes.map((t) => asTransactionObject(t)))
        .asCallback(typeof arguments[3] === 'function' ? arguments[3] : callback);
  };
}
