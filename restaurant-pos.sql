-- 1. Store Profile & Settings
CREATE TABLE store_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    store_name VARCHAR(100) DEFAULT 'Restaurant POS',
    address TEXT DEFAULT '',
    phone VARCHAR(50) DEFAULT '',
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    currency_symbol VARCHAR(10) DEFAULT '€'
);

INSERT INTO store_settings (id, store_name, currency_symbol)
VALUES (1, 'Restaurant POS', '€')
ON CONFLICT (id) DO NOTHING;

-- 2. Staff / Users (PIN-based fast login)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    pin_code VARCHAR(4) NOT NULL,
    role VARCHAR(20) NOT NULL, -- 'admin', 'cashier', 'waiter', 'kitchen'
    is_deleted BOOLEAN DEFAULT FALSE
);

-- Default Admin PIN (1234)
INSERT INTO users (name, pin_code, role) VALUES ('Admin', '1234', 'admin');

-- 3. Restaurant Tables
CREATE TABLE restaurant_tables (
    id SERIAL PRIMARY KEY,
    table_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'free', -- 'free', 'occupied', 'bill_requested'
    sort_order INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 4. Menu Categories & Items
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    prep_station VARCHAR(20) DEFAULT 'kitchen', -- 'kitchen', 'bar'
    sort_order INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE menu_items (
    id SERIAL PRIMARY KEY,
    category_id INTEGER REFERENCES categories(id),
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 5. Orders & Order Items
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    table_id INTEGER REFERENCES restaurant_tables(id),
    user_id INTEGER REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'open', -- 'open', 'paid', 'cancelled'
    order_type VARCHAR(20) DEFAULT 'dine_in', -- 'dine_in', 'takeaway'
    daily_number INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER REFERENCES menu_items(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    prep_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'preparing', 'ready', 'cancelled', 'dismissed'
    is_paid BOOLEAN DEFAULT FALSE,
    is_comped BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Payments
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    amount DECIMAL(10, 2) NOT NULL,
    method VARCHAR(20) NOT NULL, -- 'cash', 'card'
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);