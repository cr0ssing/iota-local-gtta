import * as express from 'express';
import { getTransactionsToApprove } from '../src/gtta';
import { connect } from '../src/tangle';
import { Transfer } from '@iota/core';
import { composeAPI } from '../src/patch';

const iota = composeAPI({provider: 'https://nodes.devnet.iota.org'});
iota.getNodeInfo().then((i) => console.log(i));

connect(iota, 'tcp://zmq.devnet.iota.org:5556');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept',
  );
  next();
});

app.use((req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    data += chunk;
  });

  req.on('end', () => {
    req.body = data;
    next();
  });
});

app.post('/tx', (req, res) => {
  const depth = parseInt(req.query.depth, 10);
  iota.prepareTransfers('9'.repeat(81),
      new Array<Transfer>(Math.round(Math.random() * 5)).fill({ address: generateSeed(), value: 0 }))
    .then((trytes) => iota.sendTrytes(trytes, depth, 9))
    .then((txs) => res.send(txs[0].bundle))
    .catch((e) => {
      res.status(400);
      res.send(e.message || e);
    });
});

app.get('/gtta', (req, res) => {
  const depth = req.query.depth;
  getTransactionsToApprove(depth)
    .then((tips) => res.json(tips))
    .catch((e) => {
      res.status(400);
      res.send(e.message || e);
    });
});

app.listen(3000);

function generateSeed(length = 81) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ9';
  const retVal = [];
  for (let i = 0, n = charset.length; i < length; ++i) {
    retVal[i] = charset.charAt(Math.floor(Math.random() * n));
  }
  const result = retVal.join('');
  return result;
}
