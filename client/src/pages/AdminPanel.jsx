import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../socket';

export default function AdminPanel({ user }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('menu'); // 'menu' | 'tables' | 'staff' | 'store' | 'reports'

  // Shared theme state across Cashier, Kitchen & Admin Settings via localStorage
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('bistro_pos_theme') || 'dark';
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('bistro_pos_theme', nextTheme);
  };

  // Dynamic Theme Palette Dictionary
  const t = {
    bg: theme === 'dark' ? '#0f172a' : '#f8fafc',
    cardBg: theme === 'dark' ? '#1e293b' : '#ffffff',
    textMain: theme === 'dark' ? '#f8fafc' : '#0f172a',
    textMuted: theme === 'dark' ? '#94a3b8' : '#64748b',
    border: theme === 'dark' ? '#334155' : '#cbd5e1',
    inputBg: theme === 'dark' ? '#0f172a' : '#f1f5f9',
    inputBorder: theme === 'dark' ? '#334155' : '#cbd5e1',
    tabActiveBg: theme === 'dark' ? '#1e293b' : '#ffffff',
  };

  // Menu state
  const [menu, setMenu] = useState([]);
  const [newCatName, setNewCatName] = useState('');
  const [newCatStation, setNewCatStation] = useState('kitchen');
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCatId, setNewItemCatId] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemPrice, setEditItemPrice] = useState('');

  // Tables state
  const [tables, setTables] = useState([]);
  const [newTableName, setNewTableName] = useState('');

  // Staff state
  const [staff, setStaff] = useState([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPin, setNewStaffPin] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('waiter');

  // Store settings state
  const [settings, setSettings] = useState({
    store_name: '',
    address: '',
    phone: '',
    tax_rate: 0,
    currency_symbol: '€',
  });
  const [savedBanner, setSavedBanner] = useState(false);

  // Daily report (.txt) & Purge state
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [reportResult, setReportResult] = useState(null);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [isClearingOrders, setIsClearingOrders] = useState(false);
  const [clearMessage, setClearMessage] = useState(null);

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/login');
      return;
    }
    fetchMenu();
    fetchTables();
    fetchStaff();
    fetchSettings();
  }, [user, navigate]);

  const fetchMenu = async () => {
    const res = await axios.get(`${API_URL}/api/menu?all=true`);
    setMenu(res.data);
    if (res.data.length > 0 && !newItemCatId) {
      setNewItemCatId(res.data[0].id);
    }
  };

  const fetchTables = async () => {
    const res = await axios.get(`${API_URL}/api/tables`);
    setTables(res.data);
  };

  const fetchStaff = async () => {
    const res = await axios.get(`${API_URL}/api/users`);
    setStaff(res.data);
  };

  const fetchSettings = async () => {
    const res = await axios.get(`${API_URL}/api/settings`);
    if (res.data) setSettings(res.data);
  };

  // --- MENU HANDLERS ---
  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    await axios.post(`${API_URL}/api/menu/categories`, {
      name: newCatName.trim(),
      prep_station: newCatStation,
    });
    setNewCatName('');
    fetchMenu();
  };

  const handleMoveCategory = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= menu.length) return;

    const updatedMenu = [...menu];
    const [moved] = updatedMenu.splice(index, 1);
    updatedMenu.splice(targetIndex, 0, moved);
    setMenu(updatedMenu);

    const orderedIds = updatedMenu.map((c) => c.id);
    await axios.put(`${API_URL}/api/menu/categories/reorder`, { orderedIds });
  };

  const handleDeleteCategory = async (categoryId, categoryName) => {
    if (!window.confirm(`Delete the "${categoryName}" category and all items inside it?`)) return;
    await axios.delete(`${API_URL}/api/menu/categories/${categoryId}`);
    fetchMenu();
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemPrice || !newItemCatId) return;
    await axios.post(`${API_URL}/api/menu/items`, {
      category_id: parseInt(newItemCatId, 10),
      name: newItemName.trim(),
      price: parseFloat(newItemPrice),
    });
    setNewItemName('');
    setNewItemPrice('');
    fetchMenu();
  };

  const handleMoveItem = async (catIndex, itemIndex, direction) => {
    const items = [...menu[catIndex].items];
    const targetIndex = itemIndex + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const [moved] = items.splice(itemIndex, 1);
    items.splice(targetIndex, 0, moved);

    const updatedMenu = [...menu];
    updatedMenu[catIndex] = { ...updatedMenu[catIndex], items };
    setMenu(updatedMenu);

    const orderedIds = items.map((i) => i.id);
    await axios.put(`${API_URL}/api/menu/items/reorder`, { orderedIds });
  };

  const handleToggleItemAvailability = async (item) => {
    await axios.patch(`${API_URL}/api/menu/items/${item.id}`, {
      is_available: !item.is_available,
    });
    fetchMenu();
  };

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Delete this menu item?')) return;
    await axios.delete(`${API_URL}/api/menu/items/${itemId}`);
    fetchMenu();
  };

  const startEditingItem = (item) => {
    setEditingItemId(item.id);
    setEditItemName(item.name);
    setEditItemPrice(parseFloat(item.price).toFixed(2));
  };

  const cancelEditingItem = () => {
    setEditingItemId(null);
    setEditItemName('');
    setEditItemPrice('');
  };

  const handleSaveEditItem = async (itemId) => {
    const trimmedName = editItemName.trim();
    const parsedPrice = parseFloat(editItemPrice);
    if (!trimmedName || isNaN(parsedPrice) || parsedPrice < 0) {
      alert('Please enter a valid item name and price.');
      return;
    }

    await axios.patch(`${API_URL}/api/menu/items/${itemId}`, {
      name: trimmedName,
      price: parsedPrice,
    });
    setEditingItemId(null);
    fetchMenu();
  };

  // --- TABLE HANDLERS ---
  const handleAddTable = async (e) => {
    e.preventDefault();
    if (!newTableName.trim()) return;
    await axios.post(`${API_URL}/api/tables`, { table_number: newTableName.trim() });
    setNewTableName('');
    fetchTables();
  };

  const handleMoveTable = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= tables.length) return;

    const updatedTables = [...tables];
    const [moved] = updatedTables.splice(index, 1);
    updatedTables.splice(targetIndex, 0, moved);
    setTables(updatedTables);

    const orderedIds = updatedTables.map((t) => t.id);
    await axios.put(`${API_URL}/api/tables/reorder`, { orderedIds });
  };

  const handleDeleteTable = async (id) => {
    if (!window.confirm('Delete this table?')) return;
    await axios.delete(`${API_URL}/api/tables/${id}`);
    fetchTables();
  };

  // --- STAFF HANDLERS ---
  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (!newStaffName.trim() || newStaffPin.length !== 4) return;
    await axios.post(`${API_URL}/api/users`, {
      name: newStaffName.trim(),
      pin_code: newStaffPin,
      role: newStaffRole,
    });
    setNewStaffName('');
    setNewStaffPin('');
    fetchStaff();
  };

  const handleDeleteStaff = async (id) => {
    if (!window.confirm('Remove this staff member?')) return;
    await axios.delete(`${API_URL}/api/users/${id}`);
    if (id === user.id) {
      navigate('/login');
      return;
    }
    fetchStaff();
  };

  // --- STORE SETTINGS HANDLER ---
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    await axios.put(`${API_URL}/api/settings`, settings);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2500);
  };

  // --- DAILY REPORT (.TXT) & CLEAR ORDERS HANDLERS ---
  const handleExportDailyReport = async () => {
    setIsExportingReport(true);
    try {
      const res = await axios.post(`${API_URL}/api/reports/daily-txt`, { date: reportDate });
      setReportResult(res.data);
    } catch (err) {
      alert('Failed to generate daily report');
    } finally {
      setIsExportingReport(false);
    }
  };

  const handleClearOrdersByDate = async () => {
    const confirmed = window.confirm(
      `WARNING: This will permanently delete ALL orders, items, and payments from ${reportDate} in the database and reset the next ticket number for that date to #1.\n\nAre you sure you want to continue?`
    );
    if (!confirmed) return;

    setIsClearingOrders(true);
    setClearMessage(null);
    try {
      const res = await axios.post(`${API_URL}/api/admin/orders/clear-by-date`, {
        date: reportDate,
        user_id: user.id,
      });
      setClearMessage(res.data.message);
      setReportResult(null);
      fetchTables();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to clear orders');
    } finally {
      setIsClearingOrders(false);
    }
  };

  if (!user || user.role !== 'admin') return null;

  const inputStyle = {
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${t.inputBorder}`,
    background: t.inputBg,
    color: t.textMain,
    fontSize: '14px',
  };

  const arrowBtnStyle = (disabled) => ({
    padding: '4px 8px',
    borderRadius: '6px',
    border: `1px solid ${t.border}`,
    background: disabled ? t.inputBg : t.cardBg,
    color: disabled ? t.textMuted : t.textMain,
    fontSize: '12px',
    fontWeight: '700',
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.textMain }}>
      {/* HEADER */}
      <header style={{
        height: '68px',
        background: t.cardBg,
        borderBottom: `1px solid ${t.border}`,
        padding: '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '20px', fontWeight: '800', color: '#a855f7' }}>
            ⚙ Admin Control Panel
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* THEME TOGGLE BUTTON */}
          <button
            onClick={toggleTheme}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: `1px solid ${t.border}`,
              background: t.inputBg,
              color: t.textMain,
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>

          <button
            onClick={() => navigate('/cashier')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              border: 'none',
              background: '#0284c7',
              color: '#fff',
              fontWeight: '700',
              cursor: 'pointer',
            }}
          >
            ← Back to POS Terminal
          </button>
        </div>
      </header>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '10px', padding: '20px 24px 0', borderBottom: `1px solid ${t.border}` }}>
        {[
          { id: 'menu', label: '🍔 Menu & Categories' },
          { id: 'tables', label: '🪑 Floor Tables' },
          { id: 'staff', label: '👤 Staff & PINs' },
          { id: 'store', label: '🏪 Store Profile' },
          { id: 'reports', label: '📄 Daily Reports (.txt)' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 20px',
              borderRadius: '10px 10px 0 0',
              border: 'none',
              background: activeTab === tab.id ? t.cardBg : 'transparent',
              color: activeTab === tab.id ? '#38bdf8' : t.textMuted,
              fontWeight: '700',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div style={{ padding: '24px', maxWidth: '1000px' }}>
        {/* 1. MENU & CATEGORIES TAB */}
        {activeTab === 'menu' && (
          <div>
            {/* ADD CATEGORY FORM */}
            <form onSubmit={handleAddCategory} style={{ background: t.cardBg, padding: '18px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${t.border}` }}>
              <h3 style={{ fontSize: '15px', marginBottom: '12px', color: '#38bdf8' }}>Add New Category</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  placeholder="Category Name (e.g. Desserts)"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  style={{ ...inputStyle, flex: 2 }}
                />
                <select
                  value={newCatStation}
                  onChange={(e) => setNewCatStation(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="kitchen">Kitchen Station</option>
                  <option value="bar">Bar Station</option>
                </select>
                <button
                  type="submit"
                  style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#059669', color: '#fff', fontWeight: '700', cursor: 'pointer' }}
                >
                  + Add Category
                </button>
              </div>
            </form>

            {/* ADD MENU ITEM FORM */}
            <form onSubmit={handleAddItem} style={{ background: t.cardBg, padding: '18px', borderRadius: '12px', marginBottom: '24px', border: `1px solid ${t.border}` }}>
              <h3 style={{ fontSize: '15px', marginBottom: '12px', color: '#38bdf8' }}>Add New Menu Item</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select
                  value={newItemCatId}
                  onChange={(e) => setNewItemCatId(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  {menu.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input
                  placeholder="Item Name (e.g. Club Sandwich)"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  style={{ ...inputStyle, flex: 2 }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price (e.g. 9.50)"
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                  style={{ ...inputStyle, width: '130px' }}
                />
                <button
                  type="submit"
                  style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#fff', fontWeight: '700', cursor: 'pointer' }}
                >
                  + Add Item
                </button>
              </div>
            </form>

            {/* EXISTING CATEGORIES & ITEMS LIST */}
            {menu.map((cat, catIndex) => (
              <div key={cat.id} style={{ background: t.cardBg, padding: '18px', borderRadius: '12px', marginBottom: '16px', border: `1px solid ${t.border}` }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: `1px solid ${t.border}`,
                  paddingBottom: '10px',
                  marginBottom: '12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => handleMoveCategory(catIndex, -1)}
                      disabled={catIndex === 0}
                      style={arrowBtnStyle(catIndex === 0)}
                      title="Move Category Up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleMoveCategory(catIndex, 1)}
                      disabled={catIndex === menu.length - 1}
                      style={arrowBtnStyle(catIndex === menu.length - 1)}
                      title="Move Category Down"
                    >
                      ▼
                    </button>
                    <span style={{ fontSize: '17px', fontWeight: '700', marginLeft: '4px', color: t.textMain }}>{cat.name}</span>
                    <span style={{ fontSize: '11px', color: t.textMuted, textTransform: 'uppercase' }}>
                      ({cat.prep_station})
                    </span>
                  </div>

                  <button
                    onClick={() => handleDeleteCategory(cat.id, cat.name)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '6px',
                      border: '1px solid #ef4444',
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: '#f87171',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: 'pointer',
                    }}
                  >
                    Delete Category
                  </button>
                </div>

                {cat.items.length === 0 ? (
                  <div style={{ color: t.textMuted, fontSize: '13px' }}>No items in this category.</div>
                ) : (
                  cat.items.map((item, itemIndex) => {
                    const isEditing = editingItemId === item.id;

                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '10px 0',
                          borderBottom: `1px solid ${t.border}`,
                        }}
                      >
                        {isEditing ? (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                              <input
                                value={editItemName}
                                onChange={(e) => setEditItemName(e.target.value)}
                                placeholder="Item Name"
                                style={{ ...inputStyle, padding: '6px 10px', flex: 2 }}
                                autoFocus
                              />
                              <input
                                type="number"
                                step="0.01"
                                value={editItemPrice}
                                onChange={(e) => setEditItemPrice(e.target.value)}
                                placeholder="Price"
                                style={{ ...inputStyle, padding: '6px 10px', width: '110px' }}
                              />
                            </div>

                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleSaveEditItem(item.id)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: '#10b981',
                                  color: '#0f172a',
                                  fontSize: '12px',
                                  fontWeight: '800',
                                  cursor: 'pointer',
                                }}
                              >
                                ✓ Save
                              </button>
                              <button
                                onClick={cancelEditingItem}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  border: `1px solid ${t.border}`,
                                  background: t.inputBg,
                                  color: t.textMain,
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button
                                onClick={() => handleMoveItem(catIndex, itemIndex, -1)}
                                disabled={itemIndex === 0}
                                style={arrowBtnStyle(itemIndex === 0)}
                                title="Move Item Up"
                              >
                                ▲
                              </button>
                              <button
                                onClick={() => handleMoveItem(catIndex, itemIndex, 1)}
                                disabled={itemIndex === cat.items.length - 1}
                                style={arrowBtnStyle(itemIndex === cat.items.length - 1)}
                                title="Move Item Down"
                              >
                                ▼
                              </button>
                              <span style={{ fontWeight: '600', marginLeft: '4px', color: item.is_available ? t.textMain : t.textMuted }}>
                                {item.name}
                              </span>
                              <span style={{ marginLeft: '8px', color: '#0284c7', fontWeight: '700' }}>
                                {settings.currency_symbol}{parseFloat(item.price).toFixed(2)}
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => startEditingItem(item)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  border: '1px solid #38bdf8',
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  color: '#38bdf8',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                }}
                              >
                                ✎ Edit
                              </button>

                              <button
                                onClick={() => handleToggleItemAvailability(item)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: item.is_available ? '#059669' : '#64748b',
                                  color: '#fff',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                }}
                              >
                                {item.is_available ? 'Available' : 'Sold Out'}
                              </button>

                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: '#dc2626',
                                  color: '#fff',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        )}

        {/* 2. FLOOR TABLES TAB */}
        {activeTab === 'tables' && (
          <div style={{ background: t.cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${t.border}` }}>
            <form onSubmit={handleAddTable} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <input
                placeholder="New Table Name (e.g. Table 7 or Patio 1)"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="submit"
                style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#059669', color: '#fff', fontWeight: '700', cursor: 'pointer' }}
              >
                + Add Table
              </button>
            </form>

            {tables.map((table, tableIndex) => (
              <div key={table.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => handleMoveTable(tableIndex, -1)}
                    disabled={tableIndex === 0}
                    style={arrowBtnStyle(tableIndex === 0)}
                    title="Move Table Up"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => handleMoveTable(tableIndex, 1)}
                    disabled={tableIndex === tables.length - 1}
                    style={arrowBtnStyle(tableIndex === tables.length - 1)}
                    title="Move Table Down"
                  >
                    ▼
                  </button>
                  <span style={{ fontWeight: '700', marginLeft: '4px', color: t.textMain }}>{table.table_number}</span>
                  <span style={{ marginLeft: '8px', fontSize: '12px', color: table.status === 'free' ? '#10b981' : '#f59e0b', fontWeight: '700' }}>
                    {table.status.toUpperCase()}
                  </span>
                </div>
                {table.status === 'free' && (
                  <button
                    onClick={() => handleDeleteTable(table.id)}
                    style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 3. STAFF & PINS TAB */}
        {activeTab === 'staff' && (
          <div style={{ background: t.cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${t.border}` }}>
            <form onSubmit={handleAddStaff} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <input
                placeholder="Staff Name"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                style={{ ...inputStyle, flex: 2 }}
              />
              <input
                placeholder="4-Digit PIN"
                maxLength={4}
                value={newStaffPin}
                onChange={(e) => setNewStaffPin(e.target.value.replace(/\D/g, ''))}
                style={{ ...inputStyle, width: '130px' }}
              />
              <select value={newStaffRole} onChange={(e) => setNewStaffRole(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                <option value="waiter">Waiter</option>
                <option value="cashier">Cashier</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#059669', color: '#fff', fontWeight: '700', cursor: 'pointer' }}
              >
                + Add Staff
              </button>
            </form>

            {staff.map((u) => {
              const activeAdminsCount = staff.filter((s) => s.role === 'admin').length;
              const isLastAdmin = u.role === 'admin' && activeAdminsCount <= 1;

              return (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${t.border}` }}>
                  <div>
                    <span style={{ fontWeight: '700', color: t.textMain }}>{u.name}</span>
                    <span style={{ marginLeft: '12px', fontSize: '12px', color: '#38bdf8', textTransform: 'uppercase', fontWeight: '700' }}>
                      {u.role}
                    </span>
                    <span style={{ marginLeft: '12px', fontSize: '12px', color: t.textMuted }}>PIN: {u.pin_code}</span>
                    {u.id === user.id && (
                      <span style={{ marginLeft: '10px', fontSize: '11px', color: '#10b981', fontWeight: '700' }}>
                        (You)
                      </span>
                    )}
                  </div>

                  {!isLastAdmin && (
                    <button
                      onClick={() => handleDeleteStaff(u.id)}
                      style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 4. STORE PROFILE TAB */}
        {activeTab === 'store' && (
          <form onSubmit={handleSaveSettings} style={{ background: t.cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: t.textMuted, marginBottom: '4px' }}>Store Name</label>
              <input value={settings.store_name || ''} onChange={(e) => setSettings({ ...settings, store_name: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: t.textMuted, marginBottom: '4px' }}>Address</label>
              <input value={settings.address || ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: t.textMuted, marginBottom: '4px' }}>Phone</label>
                <input value={settings.phone || ''} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div style={{ width: '120px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: t.textMuted, marginBottom: '4px' }}>Currency</label>
                <input value={settings.currency_symbol || '€'} onChange={(e) => setSettings({ ...settings, currency_symbol: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
              </div>
            </div>
            <button
              type="submit"
              style={{ padding: '12px', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#fff', fontWeight: '700', cursor: 'pointer', marginTop: '6px' }}
            >
              {savedBanner ? '✓ Saved!' : 'Save Store Profile'}
            </button>
          </form>
        )}

        {/* 5. DAILY REPORTS (.TXT) & DAY RESET TAB */}
        {activeTab === 'reports' && (
          <div style={{ background: t.cardBg, padding: '20px', borderRadius: '12px', border: `1px solid ${t.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: '800', color: '#38bdf8' }}>
                  Daily Sales & Audit Report (.txt)
                </h3>
                <p style={{ fontSize: '13px', color: t.textMuted, marginTop: '4px' }}>
                  Generates a dated <code>YYYY-MM-DD.txt</code> file in your <code>reports/</code> folder with Cash, Card, On the House, Cancelled Orders, and Cancelled Items on Completed Orders.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => {
                    setReportDate(e.target.value);
                    setClearMessage(null);
                  }}
                  style={inputStyle}
                />
                <button
                  onClick={handleExportDailyReport}
                  disabled={isExportingReport}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#10b981',
                    color: '#0f172a',
                    fontWeight: '800',
                    fontSize: '13px',
                    cursor: isExportingReport ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isExportingReport ? 'Generating...' : '💾 Save Daily .TXT Report'}
                </button>
              </div>
            </div>

            {clearMessage && (
              <div style={{
                marginTop: '14px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#fca5a5',
                fontSize: '13px',
                fontWeight: '700',
              }}>
                🗑️ {clearMessage}
              </div>
            )}

            {/* ADMIN DANGER ZONE: PURGE ORDERS & RESET TICKET #1 */}
            <div style={{
              marginTop: '18px',
              padding: '14px 16px',
              borderRadius: '10px',
              background: 'rgba(220, 38, 38, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '800', color: '#f87171' }}>
                  ⚠️ Reset Day / Delete Orders for {reportDate}
                </div>
                <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '2px' }}>
                  Permanently removes all orders stored in the database for the selected date and resets the next ticket number back to <strong>#1</strong>.
                </div>
              </div>

              <button
                onClick={handleClearOrdersByDate}
                disabled={isClearingOrders}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  border: '1px solid #ef4444',
                  background: '#dc2626',
                  color: '#fff',
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: isClearingOrders ? 'not-allowed' : 'pointer',
                }}
              >
                {isClearingOrders ? 'Deleting...' : `🗑️ Delete ${reportDate} Orders & Reset #1`}
              </button>
            </div>

            {reportResult && (
              <div style={{ marginTop: '18px' }}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#10b981',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '12px',
                }}>
                  ✅ Saved to: <code>{reportResult.filePath}</code>
                </div>
                <pre style={{
                  background: theme === 'dark' ? '#0f172a' : '#f1f5f9',
                  border: `1px solid ${t.border}`,
                  borderRadius: '10px',
                  padding: '16px',
                  color: t.textMain,
                  fontSize: '12px',
                  lineHeight: '1.5',
                  maxHeight: '420px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                }}>
                  {reportResult.reportText}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}