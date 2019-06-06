import { Hash } from '@iota/core/typings/types';
import * as zmq from 'zeromq';
import { composeAPI } from '@iota/core';

const iota = composeAPI({
  provider: 'https://nodes.devnet.iota.org',
});

iota.getNodeInfo().then(async (i) => console.log(i));

const txs = new Map<Hash, Info>();
export const milestones = new Map<number, Set<Info>>();
export const tails = new Map<Hash, Info>();
const consistent = new Set<Hash>();

export let latestMilestone: number;
export let availableDepth = -1;
const MAX_DEPTH = 5;

export class Info {
  public readonly directApprovers = new Set<Info>();
  public approvers: number = 0;

  constructor(public readonly hash: Hash, public readonly bundle: Hash, public trunk?: Info, public branch?: Info) {}
}

const sock = zmq.socket('sub');
sock.connect('tcp://zmq.devnet.iota.org:5556');
sock.on('message', (data: any) => {
  try {
    const tp = data.toString();
    const arr = tp.split(' ');

    switch (arr[0]) {
      case 'tx':
        const hash: Hash = arr[1];
        const trunk = arr[9];
        const branch = arr[10];
        const bundle = arr[8];
        const info = new Info(hash, bundle, txs.get(trunk), txs.get(branch));
        if (arr[6] === '0') {
          tails.set(bundle, info);
        }
        txs.set(hash, info);

        addApprover(info);
        break;
      case 'sn':
        const milestone = parseInt(arr[1], 10);
        if (latestMilestone !== milestone) {
          console.log('New milestone:', milestone);
          latestMilestone = milestone;
          removeOldApprovers();
          milestones.set(milestone, new Set<Info>());
        }
        latestMilestone = milestone;
        const tx = txs.get(arr[2]);
        if (tx) {
          const confirmed = milestones.get(milestone);
          if (confirmed) {
            confirmed.add(tx);
            if (milestones.size - 1 > availableDepth) {
              availableDepth++;
              console.log(`Depth ${availableDepth} is available.`);
            }
          }
        }
        break;
    }
  } catch (e) {
    console.error(e);
  }
});
sock.subscribe('tx');
sock.subscribe('sn');

function addApprover(approver: Info) {
  const add = (info?: Info) => {
    if (info) {
      info.directApprovers.add(approver);
    }
  };
  add(approver.trunk);
  add(approver.branch);
  const visited = new Set<Info>();
  updateRecursivly(visited, approver.trunk);
  updateRecursivly(visited, approver.branch);
}

function removeOldApprovers() {
  Array.from(milestones.keys())
    .filter((i) => milestones.get(i)!.size === 0)
    .forEach((i) => milestones.delete(i));
  const toMarkIndex = latestMilestone - MAX_DEPTH;
  console.log('Mark milestone', toMarkIndex);
  const toMark = milestones.get(toMarkIndex);
  if (toMark) {
    console.log(`Mark ${toMark.size} txs.`);
    toMark.forEach((tx) => {
      tx.branch = undefined;
      tx.trunk = undefined;
    });
  }
  const toDeleteIndex = toMarkIndex - 1;
  console.log('Delete milestone', toDeleteIndex);
  const toDelete = milestones.get(toDeleteIndex);
  if (toDelete) {
    console.log(`Delete ${toDelete.size} txs.`);
    Array.from(toDelete).map((tx) => tx.hash).forEach((hash) => {
      txs.delete(hash);
      tails.delete(hash);
      consistent.delete(hash);
    });
    milestones.delete(toDeleteIndex);
  }
}

function updateRecursivly(visited: Set<Info>, approved?: Info) {
  if (approved && !visited.has(approved)) {
    visited.add(approved);
    approved.approvers++;
    updateRecursivly(visited, approved.trunk);
    updateRecursivly(visited, approved.branch);
  }
}

export async function areTxsConsistent(...txs: Hash[]) {
  try {
    const toCheck = txs.filter((t) => !consistent.has(t));
    if (toCheck.length > 0) {
      await iota.getBalances([], 50, toCheck);
      toCheck.forEach((t) => consistent.add(t));
    }
    return true;
  } catch (e) {
    return false;
  }
}
