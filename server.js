import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dayjs from 'dayjs';
import { query } from './db.js';

const app = express();

// ✅ CORS untuk semua origin + jawab preflight
app.use(cors());                 // set header CORS
app.options('*', cors());        // <-- penting: handle OPTIONS preflight

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

// Health
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ===== Products =====
app.get('/products', async (req, res) => {
  const q = (req.query.q || '').trim();
  const r = await query(`SELECT id, sku, barcode, name, price, stock, unit FROM pos.products
                         WHERE ($1 = '' OR name ILIKE '%'||$1||'%' OR sku ILIKE '%'||$1||'%' OR barcode ILIKE '%'||$1||'%')
                         AND is_active = TRUE
                         ORDER BY name ASC LIMIT 200`, [q]);
  res.json(r.rows);
});

app.post('/products', async (req, res) => {
  const { sku, barcode, name, price, stock = 0, unit = 'pcs' } = req.body;
  if (!name || !Number.isInteger(price)) return res.status(400).json({ error: 'name & price (integer rupiah) required' });
  const r = await query(`INSERT INTO pos.products(sku, barcode, name, price, stock, unit)
                         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [sku, barcode, name, price, stock, unit]);
  res.status(201).json(r.rows[0]);
});

// ===== Sales =====
app.post('/sales', async (req, res) => {
  const { id, cashier = 'kasir', items = [], discount = 0, pay_cash = 0, pay_edc = 0, pay_qr = 0, note = '' } = req.body;
  if (!items.length) return res.status(400).json({ error: 'items required' });

  const subtotal = items.reduce((s, it) => s + (it.price * it.qty - (it.discount || 0)), 0);
  const tax = 0;
  const total = Math.max(0, subtotal - discount + tax);
  const change = Math.max(0, (pay_cash + pay_edc + pay_qr) - total);

  try {
    await query('BEGIN');
    await query(`INSERT INTO pos.sales(id, datetime, cashier, subtotal, discount, tax, total, pay_cash, pay_edc, pay_qr, "change", note)
                 VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, dayjs().toISOString(), cashier, subtotal, discount, tax, total, pay_cash, pay_edc, pay_qr, change, note]);

    for (const it of items) {
      await query(`INSERT INTO pos.sale_items(sale_id, product_id, qty, price, discount, total)
                   VALUES($1,$2,$3,$4,$5,$6)`,
        [id, it.product_id, it.qty, it.price, it.discount || 0, Math.round(it.qty * it.price - (it.discount || 0))]);
      await query(`INSERT INTO pos.stock_moves(product_id, qty_change, reason, ref)
                   VALUES($1,$2,'sale',$3)`, [it.product_id, -it.qty, id]);
      await query(`UPDATE pos.products SET stock = COALESCE(stock,0) - $1 WHERE id=$2`, [it.qty, it.product_id]);
    }
    await query('COMMIT');
    res.status(201).json({ id, total, change });
  } catch (e) {
    await query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'failed to create sale' });
  }
});

app.get('/sales/:id', async (req, res) => {
  const id = req.params.id;
  const sale = await query('SELECT * FROM pos.sales WHERE id=$1', [id]);
  const items = await query(`SELECT si.*, p.name FROM pos.sale_items si JOIN pos.products p ON p.id = si.product_id WHERE sale_id=$1`, [id]);
  if (!sale.rowCount) return res.status(404).json({ error: 'not found' });
  res.json({ sale: sale.rows[0], items: items.rows });
});

// ===== Simple report =====
app.get('/reports/daily', async (req, res) => {
  const day = (req.query.day || dayjs().format('YYYY-MM-DD')) + ' 00:00:00+00';
  const r = await query(`SELECT date_trunc('hour', datetime) AS hour, SUM(total) AS total
                         FROM pos.sales WHERE datetime::date = $1::date
                         GROUP BY 1 ORDER BY 1`, [day]);
  res.json(r.rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`POS API running on :${PORT}`));
