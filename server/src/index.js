import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { pool } from './db.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  },
});

app.use(cors());
app.use(express.json());

io.on('connection', (socket) => {
  console.log(`Monitor/Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Helper: Calculate next daily order number (resets at midnight)
async function getNextDailyNumber(client) {
  const res = await client.query(
    `SELECT COALESCE(MAX(daily_number), 0) + 1 AS next_num 
     FROM orders 
     WHERE DATE(created_at) = CURRENT_DATE`
  );
  return res.rows[0].next_num;
}

// ==========================================
// AUTHENTICATION (4-DIGIT PIN LOGIN)
// ==========================================
app.post('/api/login', async (req, res) => {
  const { pin_code } = req.body;
  try {
    const result = await pool.query(
      'SELECT id, name, role FROM users WHERE pin_code = $1 AND is_deleted = FALSE LIMIT 1',
      [pin_code]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid PIN code' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==========================================
// STORE PROFILE & SETTINGS
// ==========================================
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM store_settings WHERE id = 1');
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load store settings' });
  }
});

app.put('/api/settings', async (req, res) => {
  const { store_name, address, phone, tax_rate, currency_symbol } = req.body;
  try {
    const result = await pool.query(
      `UPDATE store_settings 
       SET store_name = $1, address = $2, phone = $3, tax_rate = $4, currency_symbol = $5 
       WHERE id = 1 RETURNING *`,
      [store_name, address, phone, tax_rate, currency_symbol]
    );
    io.emit('settings_updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update store settings' });
  }
});

// ==========================================
// TABLES (DINE-IN FLOOR PLAN)
// ==========================================
app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.id, 
        t.table_number, 
        t.status,
        t.sort_order,
        o.id AS active_order_id,
        o.daily_number,
        GREATEST(
          0,
          COALESCE(items_agg.gross_total, 0) - COALESCE(pay_agg.paid_total, 0)
        ) AS current_total,
        COALESCE(pay_agg.paid_total, 0) AS already_paid,
        COALESCE(items_agg.is_ready, FALSE) AS is_ready
      FROM restaurant_tables t
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
      LEFT JOIN (
        SELECT
          oi.order_id,
          SUM(CASE WHEN oi.prep_status NOT IN ('cancelled', 'dismissed') AND oi.is_comped = FALSE THEN oi.quantity * m.price ELSE 0 END) AS gross_total,
          (
            COUNT(oi.id) FILTER (WHERE oi.prep_status NOT IN ('cancelled', 'dismissed')) > 0
            AND COUNT(oi.id) FILTER (WHERE oi.prep_status NOT IN ('ready', 'cancelled', 'dismissed')) = 0
          ) AS is_ready
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        GROUP BY oi.order_id
      ) items_agg ON items_agg.order_id = o.id
      LEFT JOIN (
        SELECT order_id, SUM(amount) AS paid_total
        FROM payments
        GROUP BY order_id
      ) pay_agg ON pay_agg.order_id = o.id
      WHERE t.is_deleted = FALSE
      ORDER BY t.sort_order ASC, t.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tables' });
  }
});

app.post('/api/tables', async (req, res) => {
  const { table_number } = req.body;
  try {
    const activeCheck = await pool.query(
      'SELECT id FROM restaurant_tables WHERE LOWER(table_number) = LOWER($1) AND is_deleted = FALSE',
      [table_number]
    );
    if (activeCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Table name already exists' });
    }

    const maxRes = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM restaurant_tables WHERE is_deleted = FALSE'
    );
    const nextOrder = maxRes.rows[0].next_order;

    const deletedCheck = await pool.query(
      'SELECT id FROM restaurant_tables WHERE LOWER(table_number) = LOWER($1) AND is_deleted = TRUE LIMIT 1',
      [table_number]
    );
    if (deletedCheck.rows.length > 0) {
      const reactivated = await pool.query(
        `UPDATE restaurant_tables 
         SET table_number = $1, status = 'free', is_deleted = FALSE, sort_order = $2 
         WHERE id = $3 
         RETURNING *`,
        [table_number, nextOrder, deletedCheck.rows[0].id]
      );
      io.emit('tables_updated');
      return res.status(201).json(reactivated.rows[0]);
    }

    const result = await pool.query(
      "INSERT INTO restaurant_tables (table_number, status, is_deleted, sort_order) VALUES ($1, 'free', FALSE, $2) RETURNING *",
      [table_number, nextOrder]
    );
    io.emit('tables_updated');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Failed to add table' });
  }
});

app.put('/api/tables/reorder', async (req, res) => {
  const { orderedIds } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query('UPDATE restaurant_tables SET sort_order = $1 WHERE id = $2', [i + 1, orderedIds[i]]);
    }
    await client.query('COMMIT');
    io.emit('tables_updated');
    res.json({ message: 'Tables reordered' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder tables' });
  } finally {
    client.release();
  }
});

app.delete('/api/tables/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const activeCheck = await pool.query(
      'SELECT status FROM restaurant_tables WHERE id = $1',
      [id]
    );
    if (activeCheck.rows[0]?.status !== 'free') {
      return res.status(400).json({ error: 'Cannot delete an occupied table' });
    }

    await pool.query('DELETE FROM restaurant_tables WHERE id = $1', [id]);
    io.emit('tables_updated');
    res.json({ message: 'Table deleted' });
  } catch (err) {
    if (err.code === '23503') {
      await pool.query(
        'UPDATE restaurant_tables SET is_deleted = TRUE WHERE id = $1',
        [id]
      );
      io.emit('tables_updated');
      return res.json({ message: 'Table archived' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to delete table' });
  }
});

// ==========================================
// TAKEAWAY ORDERS
// ==========================================
app.get('/api/takeaway', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        o.id, 
        o.daily_number, 
        o.created_at,
        GREATEST(
          0,
          COALESCE(items_agg.gross_total, 0) - COALESCE(pay_agg.paid_total, 0)
        ) AS current_total,
        COALESCE(pay_agg.paid_total, 0) AS already_paid,
        COALESCE(items_agg.is_ready, FALSE) AS is_ready
      FROM orders o
      LEFT JOIN (
        SELECT
          oi.order_id,
          SUM(CASE WHEN oi.prep_status NOT IN ('cancelled', 'dismissed') AND oi.is_comped = FALSE THEN oi.quantity * m.price ELSE 0 END) AS gross_total,
          (
            COUNT(oi.id) FILTER (WHERE oi.prep_status NOT IN ('cancelled', 'dismissed')) > 0
            AND COUNT(oi.id) FILTER (WHERE oi.prep_status NOT IN ('ready', 'cancelled', 'dismissed')) = 0
          ) AS is_ready
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.id
        GROUP BY oi.order_id
      ) items_agg ON items_agg.order_id = o.id
      LEFT JOIN (
        SELECT order_id, SUM(amount) AS paid_total
        FROM payments
        GROUP BY order_id
      ) pay_agg ON pay_agg.order_id = o.id
      WHERE o.order_type = 'takeaway' AND o.status = 'open'
      ORDER BY o.created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load takeaway orders' });
  }
});

// ==========================================
// MENU & ADMIN MENU MANAGEMENT
// ==========================================
app.get('/api/menu', async (req, res) => {
  const includeUnavailable = req.query.all === 'true';
  try {
    const categoriesRes = await pool.query(
      'SELECT * FROM categories WHERE is_deleted = FALSE ORDER BY sort_order ASC, id ASC'
    );
    const itemsQuery = includeUnavailable
      ? 'SELECT * FROM menu_items WHERE is_deleted = FALSE ORDER BY sort_order ASC, id ASC'
      : 'SELECT * FROM menu_items WHERE is_available = TRUE AND is_deleted = FALSE ORDER BY sort_order ASC, id ASC';
    const itemsRes = await pool.query(itemsQuery);

    const menu = categoriesRes.rows.map((cat) => ({
      ...cat,
      items: itemsRes.rows.filter((item) => item.category_id === cat.id),
    }));

    res.json(menu);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

app.post('/api/menu/items', async (req, res) => {
  const { category_id, name, price } = req.body;
  try {
    const maxRes = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM menu_items WHERE category_id = $1',
      [category_id]
    );
    const nextOrder = maxRes.rows[0].next_order;

    const result = await pool.query(
      'INSERT INTO menu_items (category_id, name, price, is_available, is_deleted, sort_order) VALUES ($1, $2, $3, TRUE, FALSE, $4) RETURNING *',
      [category_id, name, price, nextOrder]
    );
    io.emit('menu_updated');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add menu item' });
  }
});

app.patch('/api/menu/items/:id', async (req, res) => {
  const { name, price, is_available, category_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE menu_items 
       SET name = COALESCE($1, name),
           price = COALESCE($2, price),
           is_available = COALESCE($3, is_available),
           category_id = COALESCE($4, category_id)
       WHERE id = $5 RETURNING *`,
      [name, price, is_available, category_id, req.params.id]
    );
    io.emit('menu_updated');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

app.put('/api/menu/items/reorder', async (req, res) => {
  const { orderedIds } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query('UPDATE menu_items SET sort_order = $1 WHERE id = $2', [i + 1, orderedIds[i]]);
    }
    await client.query('COMMIT');
    io.emit('menu_updated');
    res.json({ message: 'Items reordered' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder menu items' });
  } finally {
    client.release();
  }
});

app.delete('/api/menu/items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);
    io.emit('menu_updated');
    res.json({ message: 'Menu item permanently deleted' });
  } catch (err) {
    if (err.code === '23503') {
      await pool.query(
        'UPDATE menu_items SET is_deleted = TRUE, is_available = FALSE WHERE id = $1',
        [id]
      );
      io.emit('menu_updated');
      return res.json({ message: 'Menu item archived' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

app.post('/api/menu/categories', async (req, res) => {
  const { name, prep_station = 'kitchen' } = req.body;
  try {
    const maxRes = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM categories'
    );
    const nextOrder = maxRes.rows[0].next_order;

    const result = await pool.query(
      'INSERT INTO categories (name, prep_station, is_deleted, sort_order) VALUES ($1, $2, FALSE, $3) RETURNING *',
      [name, prep_station, nextOrder]
    );
    io.emit('menu_updated');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add category' });
  }
});

app.put('/api/menu/categories/reorder', async (req, res) => {
  const { orderedIds } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query('UPDATE categories SET sort_order = $1 WHERE id = $2', [i + 1, orderedIds[i]]);
    }
    await client.query('COMMIT');
    io.emit('menu_updated');
    res.json({ message: 'Categories reordered' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder categories' });
  } finally {
    client.release();
  }
});

app.delete('/api/menu/categories/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM menu_items 
       WHERE category_id = $1 
         AND id NOT IN (SELECT DISTINCT menu_item_id FROM order_items)`,
      [id]
    );

    await client.query(
      'UPDATE menu_items SET is_deleted = TRUE, is_available = FALSE WHERE category_id = $1',
      [id]
    );

    const remaining = await client.query(
      'SELECT COUNT(*) FROM menu_items WHERE category_id = $1',
      [id]
    );

    if (parseInt(remaining.rows[0].count, 10) === 0) {
      await client.query('DELETE FROM categories WHERE id = $1', [id]);
    } else {
      await client.query('UPDATE categories SET is_deleted = TRUE WHERE id = $1', [id]);
    }

    await client.query('COMMIT');
    io.emit('menu_updated');
    res.json({ message: 'Category removed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to delete category' });
  } finally {
    client.release();
  }
});

// ==========================================
// ADMIN STAFF & PIN MANAGEMENT
// ==========================================
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, pin_code, role FROM users WHERE is_deleted = FALSE ORDER BY id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load staff' });
  }
});

app.post('/api/users', async (req, res) => {
  const { name, pin_code, role } = req.body;
  try {
    const activeCheck = await pool.query(
      'SELECT id FROM users WHERE pin_code = $1 AND is_deleted = FALSE',
      [pin_code]
    );
    if (activeCheck.rows.length > 0) {
      return res.status(400).json({ error: 'PIN code is already in use by an active staff member' });
    }

    const deletedCheck = await pool.query(
      'SELECT id FROM users WHERE pin_code = $1 AND is_deleted = TRUE LIMIT 1',
      [pin_code]
    );
    if (deletedCheck.rows.length > 0) {
      const reactivated = await pool.query(
        `UPDATE users 
         SET name = $1, role = $2, is_deleted = FALSE 
         WHERE id = $3 
         RETURNING id, name, pin_code, role`,
        [name, role, deletedCheck.rows[0].id]
      );
      return res.status(201).json(reactivated.rows[0]);
    }

    const result = await pool.query(
      'INSERT INTO users (name, pin_code, role, is_deleted) VALUES ($1, $2, $3, FALSE) RETURNING id, name, pin_code, role',
      [name, pin_code, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Failed to add user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'User removed' });
  } catch (err) {
    if (err.code === '23503') {
      await pool.query(
        'UPDATE users SET is_deleted = TRUE WHERE id = $1',
        [id]
      );
      return res.json({ message: 'User archived' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ==========================================
// ORDERS & KITCHEN TICKETS
// ==========================================
app.get('/api/orders/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    const itemsRes = await pool.query(
      `SELECT 
        oi.id, oi.quantity, oi.notes, oi.prep_status, oi.is_paid, oi.is_comped, oi.sent_at,
        m.name, m.price
       FROM order_items oi
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = $1 AND oi.prep_status NOT IN ('cancelled', 'dismissed')
       ORDER BY oi.id ASC`,
      [orderId]
    );
    res.json(itemsRes.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load order details' });
  }
});

app.get('/api/kitchen/tickets', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        oi.id AS item_id,
        oi.order_id,
        o.daily_number,
        o.order_type,
        oi.quantity,
        oi.notes,
        oi.prep_status,
        oi.sent_at,
        m.name AS item_name,
        c.prep_station,
        t.table_number,
        u.name AS waiter_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      JOIN menu_items m ON oi.menu_item_id = m.id
      JOIN categories c ON m.category_id = c.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE oi.prep_status IN ('pending', 'preparing', 'cancelled')
      ORDER BY oi.sent_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch kitchen tickets' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { table_id = null, order_id = null, order_type = 'dine_in', user_id = 1, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'items are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let targetOrderId = order_id;
    let dailyNumber = null;

    if (!targetOrderId && order_type === 'dine_in' && table_id) {
      const existingOrder = await client.query(
        "SELECT id, daily_number FROM orders WHERE table_id = $1 AND status = 'open' LIMIT 1",
        [table_id]
      );
      if (existingOrder.rows.length > 0) {
        targetOrderId = existingOrder.rows[0].id;
        dailyNumber = existingOrder.rows[0].daily_number;
      }
    }

    if (!targetOrderId) {
      dailyNumber = await getNextDailyNumber(client);
      const newOrder = await client.query(
        `INSERT INTO orders (table_id, user_id, status, order_type, daily_number) 
         VALUES ($1, $2, 'open', $3, $4) RETURNING id, daily_number`,
        [order_type === 'dine_in' ? table_id : null, user_id, order_type, dailyNumber]
      );
      targetOrderId = newOrder.rows[0].id;
      dailyNumber = newOrder.rows[0].daily_number;
    }

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, notes, prep_status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [targetOrderId, item.menu_item_id, item.quantity || 1, item.notes || '']
      );
    }

    if (order_type === 'dine_in' && table_id) {
      await client.query(
        "UPDATE restaurant_tables SET status = 'occupied' WHERE id = $1",
        [table_id]
      );
    }

    await client.query('COMMIT');

    io.emit('tables_updated');
    io.emit('kitchen_updated');

    res.status(201).json({ message: 'Order sent to kitchen', orderId: targetOrderId, dailyNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to submit order' });
  } finally {
    client.release();
  }
});

// Update item status ('ready', 'cancelled', or 'dismissed' when kitchen presses OK)
app.patch('/api/order-items/:itemId/status', async (req, res) => {
  const { itemId } = req.params;
  const { prep_status } = req.body;

  try {
    const updatedRes = await pool.query(
      'UPDATE order_items SET prep_status = $1 WHERE id = $2 RETURNING order_id',
      [prep_status, itemId]
    );

    if (updatedRes.rows.length > 0 && prep_status === 'ready') {
      const orderId = updatedRes.rows[0].order_id;
      const checkRes = await pool.query(
        `SELECT
           o.id,
           o.daily_number,
           o.order_type,
           COUNT(oi.id) FILTER (WHERE oi.prep_status NOT IN ('cancelled', 'dismissed')) AS active_count,
           COUNT(oi.id) FILTER (WHERE oi.prep_status NOT IN ('ready', 'cancelled', 'dismissed')) AS unready_count
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE o.id = $1 AND o.status = 'open'
         GROUP BY o.id`,
        [orderId]
      );

      if (
        checkRes.rows.length > 0 &&
        checkRes.rows[0].order_type === 'takeaway' &&
        Number(checkRes.rows[0].active_count) > 0 &&
        Number(checkRes.rows[0].unready_count) === 0
      ) {
        io.emit('takeaway_order_ready', {
          orderId,
          daily_number: checkRes.rows[0].daily_number,
        });
      }
    }

    io.emit('kitchen_updated');
    io.emit('order_item_ready', { itemId, prep_status });
    io.emit('tables_updated');

    res.json({ message: 'Item status updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update item status' });
  }
});

// Batch mark selected items as "On the House" (Admin only)
app.post('/api/orders/:orderId/on-the-house', async (req, res) => {
  const { orderId } = req.params;
  const { items } = req.body; // Array of { id, quantity } to be comped
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Reset all active items on this order to is_comped = false first
    await client.query(
      `UPDATE order_items
       SET is_comped = false
       WHERE order_id = $1 AND prep_status NOT IN ('cancelled', 'dismissed')`,
      [orderId]
    );

    // 2. Apply comped quantities (splitting rows if partial quantity is requested)
    if (Array.isArray(items)) {
      for (const entry of items) {
        const targetQty = parseInt(entry.quantity, 10);
        if (!targetQty || targetQty <= 0) continue;

        const itemRes = await client.query(
          `SELECT * FROM order_items
           WHERE id = $1 AND order_id = $2 AND prep_status NOT IN ('cancelled', 'dismissed')`,
          [entry.id, orderId]
        );
        if (itemRes.rows.length === 0) continue;
        const row = itemRes.rows[0];

        if (targetQty >= row.quantity) {
          await client.query(`UPDATE order_items SET is_comped = true WHERE id = $1`, [row.id]);
        } else {
          const remainingPaidQty = row.quantity - targetQty;
          await client.query(
            `UPDATE order_items SET quantity = $1 WHERE id = $2`,
            [remainingPaidQty, row.id]
          );
          await client.query(
            `INSERT INTO order_items (order_id, menu_item_id, quantity, notes, prep_status, is_comped)
             VALUES ($1, $2, $3, $4, $5, true)`,
            [orderId, row.menu_item_id, targetQty, row.notes || '', row.prep_status]
          );
        }
      }
    }

    await client.query('COMMIT');
    io.emit('tables_updated');
    res.json({ message: 'On the house items updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ON THE HOUSE ERROR:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Batch remove/cancel selected items & quantities (All staff)
app.post('/api/orders/:orderId/cancel-items', async (req, res) => {
  const { orderId } = req.params;
  const { items } = req.body; // Array of { id, quantity }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items selected' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const entry of items) {
      const itemId = entry.id;
      const removeQty = parseInt(entry.quantity, 10) || 0;
      if (removeQty <= 0) continue;

      const itemRes = await client.query(
        'SELECT menu_item_id, quantity, notes, prep_status, is_comped FROM order_items WHERE id = $1 AND order_id = $2',
        [itemId, orderId]
      );
      if (itemRes.rows.length === 0) continue;

      const row = itemRes.rows[0];
      const currentStatus = row.prep_status;
      if (currentStatus === 'cancelled' || currentStatus === 'dismissed') continue;

      const actualRemoveQty = Math.min(removeQty, row.quantity);
      const isUnmade = currentStatus === 'pending' || currentStatus === 'preparing';
      // Unmade items turn red ('cancelled') on Kitchen Display until OK; ready items become 'dismissed'
      const cancelledStatus = isUnmade ? 'cancelled' : 'dismissed';

      if (actualRemoveQty >= row.quantity) {
        await client.query(
          'UPDATE order_items SET prep_status = $1 WHERE id = $2',
          [cancelledStatus, itemId]
        );
      } else {
        await client.query(
          'UPDATE order_items SET quantity = quantity - $1 WHERE id = $2',
          [actualRemoveQty, itemId]
        );
        await client.query(
          `INSERT INTO order_items (order_id, menu_item_id, quantity, notes, prep_status, is_comped)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, row.menu_item_id, actualRemoveQty, row.notes, cancelledStatus, row.is_comped]
        );
      }
    }

    // If no active items remain in the order, close the order and free the table
    const remainingRes = await client.query(
      "SELECT COUNT(*) AS count FROM order_items WHERE order_id = $1 AND prep_status NOT IN ('cancelled', 'dismissed')",
      [orderId]
    );
    if (parseInt(remainingRes.rows[0].count, 10) === 0) {
      const orderRes = await client.query('SELECT table_id FROM orders WHERE id = $1', [orderId]);
      await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [orderId]);
      if (orderRes.rows[0]?.table_id) {
        await client.query("UPDATE restaurant_tables SET status = 'free' WHERE id = $1", [orderRes.rows[0].table_id]);
      }
    }

    await client.query('COMMIT');
    io.emit('kitchen_updated');
    io.emit('tables_updated');
    res.json({ message: 'Selected items removed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to remove items' });
  } finally {
    client.release();
  }
});

// TRANSFER OR MERGE TABLE (All staff)
app.post('/api/orders/:orderId/transfer', async (req, res) => {
  const { orderId } = req.params;
  const { target_table_id } = req.body;

  if (!target_table_id) {
    return res.status(400).json({ error: 'Target table ID is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceOrderRes = await client.query(
      "SELECT id, table_id, daily_number FROM orders WHERE id = $1 AND status = 'open'",
      [orderId]
    );
    if (sourceOrderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source open order not found' });
    }
    const sourceOrder = sourceOrderRes.rows[0];
    const oldTableId = sourceOrder.table_id;

    if (oldTableId === parseInt(target_table_id, 10)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Order is already on this table' });
    }

    // Check if destination table already has an open order
    const destOrderRes = await client.query(
      "SELECT id, daily_number FROM orders WHERE table_id = $1 AND status = 'open' LIMIT 1",
      [target_table_id]
    );

    let finalOrderId = sourceOrder.id;
    let merged = false;

    if (destOrderRes.rows.length > 0) {
      // MERGE into destination table's active order
      const destOrder = destOrderRes.rows[0];
      await client.query(
        'UPDATE order_items SET order_id = $1 WHERE order_id = $2',
        [destOrder.id, sourceOrder.id]
      );
      await client.query(
        'UPDATE payments SET order_id = $1 WHERE order_id = $2',
        [destOrder.id, sourceOrder.id]
      );
      await client.query(
        "UPDATE orders SET status = 'cancelled', table_id = NULL WHERE id = $1",
        [sourceOrder.id]
      );
      finalOrderId = destOrder.id;
      merged = true;
    } else {
      // MOVE to free destination table
      await client.query(
        "UPDATE orders SET table_id = $1, order_type = 'dine_in' WHERE id = $2",
        [target_table_id, sourceOrder.id]
      );
    }

    // Mark destination table occupied & free old table
    await client.query(
      "UPDATE restaurant_tables SET status = 'occupied' WHERE id = $1",
      [target_table_id]
    );
    if (oldTableId) {
      await client.query(
        "UPDATE restaurant_tables SET status = 'free' WHERE id = $1",
        [oldTableId]
      );
    }

    await client.query('COMMIT');
    io.emit('tables_updated');
    io.emit('kitchen_updated');

    res.json({
      message: merged ? 'Orders merged into destination table' : 'Table transferred',
      finalOrderId,
      merged,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('TRANSFER ERROR:', err);
    res.status(500).json({ error: 'Failed to transfer table' });
  } finally {
    client.release();
  }
});

// SPLIT BILL PAYMENT (Evenly or By Selected Items)
app.post('/api/orders/:orderId/split-pay', async (req, res) => {
  const { orderId } = req.params;
  const { amount, method = 'cash', paid_items = [] } = req.body;

  const payAmount = parseFloat(amount);
  if (isNaN(payAmount) || payAmount < 0) {
    return res.status(400).json({ error: 'Valid payment amount is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Record partial payment
    if (payAmount > 0) {
      await client.query(
        'INSERT INTO payments (order_id, amount, method) VALUES ($1, $2, $3)',
        [orderId, payAmount, method]
      );
    }

    // 2. If Split by Item, mark those specific item quantities as is_paid = TRUE
    if (Array.isArray(paid_items) && paid_items.length > 0) {
      for (const entry of paid_items) {
        const targetQty = parseInt(entry.quantity, 10) || 0;
        if (targetQty <= 0) continue;

        const itemRes = await client.query(
          `SELECT * FROM order_items
           WHERE id = $1 AND order_id = $2 AND prep_status NOT IN ('cancelled', 'dismissed')`,
          [entry.id, orderId]
        );
        if (itemRes.rows.length === 0) continue;
        const row = itemRes.rows[0];

        if (targetQty >= row.quantity) {
          await client.query('UPDATE order_items SET is_paid = TRUE WHERE id = $1', [row.id]);
        } else {
          const remainingUnpaidQty = row.quantity - targetQty;
          await client.query(
            'UPDATE order_items SET quantity = $1 WHERE id = $2',
            [remainingUnpaidQty, row.id]
          );
          await client.query(
            `INSERT INTO order_items (order_id, menu_item_id, quantity, notes, prep_status, is_comped, is_paid)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
            [orderId, row.menu_item_id, targetQty, row.notes || '', row.prep_status, row.is_comped]
          );
        }
      }
    }

    // 3. Check remaining balance on the order
    const grossRes = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN oi.prep_status NOT IN ('cancelled', 'dismissed') AND oi.is_comped = FALSE THEN oi.quantity * m.price ELSE 0 END), 0) AS gross_total
       FROM order_items oi
       JOIN menu_items m ON oi.menu_item_id = m.id
       WHERE oi.order_id = $1`,
      [orderId]
    );
    const paidRes = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS paid_total FROM payments WHERE order_id = $1',
      [orderId]
    );

    const grossTotal = parseFloat(grossRes.rows[0].gross_total);
    const paidTotal = parseFloat(paidRes.rows[0].paid_total);
    const remainingBalance = Math.max(0, grossTotal - paidTotal);

    let orderClosed = false;
    // Close order automatically once remaining balance is settled (within 1 cent rounding)
    if (remainingBalance <= 0.01) {
      await client.query('UPDATE order_items SET is_paid = TRUE WHERE order_id = $1', [orderId]);
      const orderRes = await client.query(
        "UPDATE orders SET status = 'paid' WHERE id = $1 RETURNING table_id",
        [orderId]
      );
      const tableId = orderRes.rows[0]?.table_id;
      if (tableId) {
        await client.query(
          "UPDATE restaurant_tables SET status = 'free' WHERE id = $1",
          [tableId]
        );
      }
      orderClosed = true;
    }

    await client.query('COMMIT');
    io.emit('tables_updated');
    io.emit('kitchen_updated');

    res.json({
      message: orderClosed ? 'Bill fully settled and closed' : 'Partial payment recorded',
      remainingBalance,
      orderClosed,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('SPLIT PAY ERROR:', err);
    res.status(500).json({ error: 'Split payment failed' });
  } finally {
    client.release();
  }
});

// CANCEL ENTIRE ORDER
app.post('/api/orders/:orderId/cancel', async (req, res) => {
  const { orderId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE order_items 
       SET prep_status = 'cancelled' 
       WHERE order_id = $1 AND prep_status IN ('pending', 'preparing')`,
      [orderId]
    );

    const orderRes = await client.query(
      "UPDATE orders SET status = 'cancelled' WHERE id = $1 RETURNING table_id",
      [orderId]
    );

    const tableId = orderRes.rows[0]?.table_id;
    if (tableId) {
      await client.query(
        "UPDATE restaurant_tables SET status = 'free' WHERE id = $1",
        [tableId]
      );
    }

    await client.query('COMMIT');

    io.emit('tables_updated');
    io.emit('kitchen_updated');

    res.json({ message: 'Order cancelled' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel order' });
  } finally {
    client.release();
  }
});

app.post('/api/orders/:orderId/pay', async (req, res) => {
  const { orderId } = req.params;
  const { amount, method = 'cash' } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (parseFloat(amount) > 0) {
      await client.query(
        'INSERT INTO payments (order_id, amount, method) VALUES ($1, $2, $3)',
        [orderId, amount, method]
      );
    }

    await client.query('UPDATE order_items SET is_paid = TRUE WHERE order_id = $1', [orderId]);
    const orderRes = await client.query(
      "UPDATE orders SET status = 'paid' WHERE id = $1 RETURNING table_id",
      [orderId]
    );

    const tableId = orderRes.rows[0]?.table_id;
    if (tableId) {
      await client.query(
        "UPDATE restaurant_tables SET status = 'free' WHERE id = $1",
        [tableId]
      );
    }

    await client.query('COMMIT');

    io.emit('tables_updated');
    io.emit('kitchen_updated');

    res.json({ message: 'Order paid and closed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Payment failed' });
  } finally {
    client.release();
  }
});

// ==========================================
// DAILY Z-REPORT / TXT EXPORT
// ==========================================
app.post('/api/reports/daily-txt', async (req, res) => {
  try {
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const targetDate = req.body?.date || localDate;

    const settingsRes = await pool.query('SELECT * FROM store_settings WHERE id = 1');
    const store = settingsRes.rows[0] || { store_name: 'Restaurant POS', currency_symbol: '€' };
    const currency = store.currency_symbol || '€';

    // 1. Fetch all orders for targetDate (without duplicating rows when multiple split payments exist)
    const ordersRes = await pool.query(
      `SELECT 
        o.id,
        o.daily_number,
        o.order_type,
        o.status,
        o.created_at,
        t.table_number,
        u.name AS staff_name
       FROM orders o
       LEFT JOIN restaurant_tables t ON o.table_id = t.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE DATE(o.created_at) = $1
       ORDER BY o.daily_number ASC, o.id ASC`,
      [targetDate]
    );

    // 2. Fetch all payments linked to targetDate orders
    const paymentsRes = await pool.query(
      `SELECT p.id, p.order_id, p.amount, p.method
       FROM payments p
       JOIN orders o ON p.order_id = o.id
       WHERE DATE(o.created_at) = $1
       ORDER BY p.id ASC`,
      [targetDate]
    );

    // 3. Fetch all items belonging to targetDate orders
    const itemsRes = await pool.query(
      `SELECT 
        oi.id,
        oi.order_id,
        oi.quantity,
        oi.notes,
        oi.prep_status,
        oi.is_comped,
        m.name AS item_name,
        m.price,
        o.daily_number,
        o.order_type,
        o.status AS order_status,
        t.table_number
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN menu_items m ON oi.menu_item_id = m.id
       LEFT JOIN restaurant_tables t ON o.table_id = t.id
       WHERE DATE(o.created_at) = $1
       ORDER BY o.daily_number ASC, oi.id ASC`,
      [targetDate]
    );

    const orders = ordersRes.rows;
    const allPayments = paymentsRes.rows;
    const allItems = itemsRes.rows;

    const ordersById = new Map(orders.map((o) => [o.id, o]));
    const itemsByOrder = new Map();
    for (const item of allItems) {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    }

    const cashPayments = allPayments.filter((p) => p.method === 'cash');
    const cardPayments = allPayments.filter((p) => p.method === 'card');
    const cancelledOrders = orders.filter((o) => o.status === 'cancelled');
    const openOrders = orders.filter((o) => o.status === 'open');

    const compedItems = allItems.filter(
      (i) => i.order_status !== 'cancelled' && i.is_comped === true && !['cancelled', 'dismissed'].includes(i.prep_status)
    );

    const partialCancelledItems = allItems.filter(
      (i) => i.order_status !== 'cancelled' && ['cancelled', 'dismissed'].includes(i.prep_status)
    );

    const cashTotal = cashPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const cardTotal = cardPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const grandTotal = cashTotal + cardTotal;
    const compedTotal = compedItems.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
    const partialVoidTotal = partialCancelledItems.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);

    const formatSource = (o) => (o.order_type === 'dine_in' ? (o.table_number || 'Dine-In') : 'Takeaway');
    const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const lines = [];
    lines.push('============================================================');
    lines.push(`${store.store_name.toUpperCase()} — DAILY SALES & AUDIT REPORT`);
    lines.push(`Date: ${targetDate}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('============================================================');
    lines.push('');
    lines.push('SUMMARY TOTALS');
    lines.push('------------------------------------------------------------');
    lines.push(`Cash Sales (${cashPayments.length} payments):        ${currency}${cashTotal.toFixed(2)}`);
    lines.push(`Card Sales (${cardPayments.length} payments):        ${currency}${cardTotal.toFixed(2)}`);
    lines.push(`GRAND TOTAL COLLECTED:           ${currency}${grandTotal.toFixed(2)}`);
    lines.push(`On the House Value (${compedItems.reduce((s, i) => s + i.quantity, 0)} items):    ${currency}${compedTotal.toFixed(2)}`);
    lines.push(`Voided Items on Paid Orders:     ${currency}${partialVoidTotal.toFixed(2)}`);
    lines.push(`Cancelled Full Orders:           ${cancelledOrders.length}`);
    if (openOrders.length > 0) {
      lines.push(`Still Open / Unpaid Orders:      ${openOrders.length}`);
    }
    lines.push('');

    // SECTION 1: PAID BY CASH
    lines.push('============================================================');
    lines.push(`1. CASH PAYMENTS (${cashPayments.length}) — Total: ${currency}${cashTotal.toFixed(2)}`);
    lines.push('============================================================');
    if (cashPayments.length === 0) {
      lines.push('  (None)');
    } else {
      for (const p of cashPayments) {
        const o = ordersById.get(p.order_id);
        if (!o) continue;
        lines.push(`  Ticket #${o.daily_number} | ${formatSource(o)} | ${formatTime(o.created_at)} | Paid: ${currency}${parseFloat(p.amount || 0).toFixed(2)}`);
        const oItems = (itemsByOrder.get(o.id) || []).filter((i) => !['cancelled', 'dismissed'].includes(i.prep_status));
        for (const item of oItems) {
          const priceLabel = item.is_comped
            ? `${currency}0.00 (ON THE HOUSE)`
            : `${currency}${(parseFloat(item.price) * item.quantity).toFixed(2)}`;
          lines.push(`     - ${item.quantity}x ${item.item_name} -> ${priceLabel}`);
        }
      }
    }
    lines.push('');

    // SECTION 2: PAID BY CARD
    lines.push('============================================================');
    lines.push(`2. CARD PAYMENTS (${cardPayments.length}) — Total: ${currency}${cardTotal.toFixed(2)}`);
    lines.push('============================================================');
    if (cardPayments.length === 0) {
      lines.push('  (None)');
    } else {
      for (const p of cardPayments) {
        const o = ordersById.get(p.order_id);
        if (!o) continue;
        lines.push(`  Ticket #${o.daily_number} | ${formatSource(o)} | ${formatTime(o.created_at)} | Paid: ${currency}${parseFloat(p.amount || 0).toFixed(2)}`);
        const oItems = (itemsByOrder.get(o.id) || []).filter((i) => !['cancelled', 'dismissed'].includes(i.prep_status));
        for (const item of oItems) {
          const priceLabel = item.is_comped
            ? `${currency}0.00 (ON THE HOUSE)`
            : `${currency}${(parseFloat(item.price) * item.quantity).toFixed(2)}`;
          lines.push(`     - ${item.quantity}x ${item.item_name} -> ${priceLabel}`);
        }
      }
    }
    lines.push('');

    // SECTION 3: ON THE HOUSE ITEMS
    lines.push('============================================================');
    lines.push(`3. ON THE HOUSE (COMPED) ITEMS — Total Value: ${currency}${compedTotal.toFixed(2)}`);
    lines.push('============================================================');
    if (compedItems.length === 0) {
      lines.push('  (None)');
    } else {
      for (const item of compedItems) {
        lines.push(`  Ticket #${item.daily_number} (${formatSource(item)}) | ${item.quantity}x ${item.item_name} | Original Value: ${currency}${(parseFloat(item.price) * item.quantity).toFixed(2)}`);
      }
    }
    lines.push('');

    // SECTION 4: CANCELLED ITEMS ON ORDERS THAT WENT THROUGH
    lines.push('============================================================');
    lines.push(`4. CANCELLED ITEMS ON COMPLETED ORDERS — Voided Value: ${currency}${partialVoidTotal.toFixed(2)}`);
    lines.push('============================================================');
    if (partialCancelledItems.length === 0) {
      lines.push('  (None)');
    } else {
      for (const item of partialCancelledItems) {
        lines.push(`  Ticket #${item.daily_number} (${formatSource(item)}) | ${item.quantity}x ${item.item_name} | Unbilled Value: ${currency}${(parseFloat(item.price) * item.quantity).toFixed(2)} [Order Status: ${item.order_status.toUpperCase()}]`);
      }
    }
    lines.push('');

    // SECTION 5: ENTIRE ORDERS CANCELLED
    lines.push('============================================================');
    lines.push(`5. ENTIRE ORDERS CANCELLED (${cancelledOrders.length})`);
    lines.push('============================================================');
    if (cancelledOrders.length === 0) {
      lines.push('  (None)');
    } else {
      for (const o of cancelledOrders) {
        const oItems = itemsByOrder.get(o.id) || [];
        const voidedOrderSum = oItems.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
        lines.push(`  Ticket #${o.daily_number} | ${formatSource(o)} | ${formatTime(o.created_at)} | Voided Total: ${currency}${voidedOrderSum.toFixed(2)}`);
        for (const item of oItems) {
          lines.push(`     - ${item.quantity}x ${item.item_name} (${currency}${(parseFloat(item.price) * item.quantity).toFixed(2)})`);
        }
      }
    }
    lines.push('');
    lines.push('============================================================');
    lines.push('END OF REPORT');
    lines.push('============================================================');

    const reportText = lines.join('\n');

    const reportsDir = path.resolve(process.cwd(), '..', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const fileName = `${targetDate}.txt`;
    const filePath = path.join(reportsDir, fileName);
    fs.writeFileSync(filePath, reportText, 'utf8');

    res.json({
      message: 'Daily report saved',
      fileName,
      filePath,
      reportText,
    });
  } catch (err) {
    console.error('DAILY REPORT ERROR:', err);
    res.status(500).json({ error: 'Failed to generate daily report' });
  }
});

// ==========================================
// ADMIN: DELETE ALL ORDERS FOR A DATE & RESET TICKET #1
// ==========================================
app.post('/api/admin/orders/clear-by-date', async (req, res) => {
  const client = await pool.connect();
  try {
    const { date, user_id } = req.body;

    if (!date || !user_id) {
      return res.status(400).json({ error: 'Date and admin user_id are required.' });
    }

    const userRes = await client.query('SELECT role FROM users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: Admin access required.' });
    }

    await client.query('BEGIN');

    const ordersRes = await client.query(
      'SELECT id, table_id FROM orders WHERE created_at::date = $1::date',
      [date]
    );
    const orderIds = ordersRes.rows.map((r) => r.id);
    const tableIds = [...new Set(ordersRes.rows.map((r) => r.table_id).filter(Boolean))];

    if (orderIds.length > 0) {
      await client.query('DELETE FROM payments WHERE order_id = ANY($1::int[])', [orderIds]);
      await client.query('DELETE FROM order_items WHERE order_id = ANY($1::int[])', [orderIds]);
      await client.query('DELETE FROM orders WHERE id = ANY($1::int[])', [orderIds]);

      if (tableIds.length > 0) {
        await client.query(
          `UPDATE restaurant_tables
           SET status = 'free'
           WHERE id = ANY($1::int[])
             AND id NOT IN (SELECT table_id FROM orders WHERE status = 'open' AND table_id IS NOT NULL)`,
          [tableIds]
        );
      }
    }

    await client.query('COMMIT');

    io.emit('tables_updated');
    io.emit('kitchen_updated');
    io.emit('order_item_ready');

    res.json({
      message: `Deleted ${orderIds.length} order(s) for ${date}. Next ticket number is #1.`,
      deletedCount: orderIds.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('CLEAR ORDERS ERROR:', err);
    res.status(500).json({ error: `Failed to delete orders: ${err.message}` });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`POS Backend running on http://localhost:${PORT}`);
});