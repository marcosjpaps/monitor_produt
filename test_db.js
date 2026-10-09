const db = require('./api/db');
db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('voos', 'talhoes', 'voos_deletados', 'voos_lixeira', 'voo_talhoes') ORDER BY table_name, ordinal_position;`)
  .then(rows => console.log(JSON.stringify(rows, null, 2)))
  .catch(console.error);
