import * as express from 'express';
import { getTips } from './gtta';

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

app.get('/gtta', (req, res) => {
  const depth = req.query.depth;
  getTips(depth)
    .then((tips) => res.json(tips))
    .catch((e) => {
      res.status(400);
      res.send(e.message || e);
    });
});

app.listen(3000);
