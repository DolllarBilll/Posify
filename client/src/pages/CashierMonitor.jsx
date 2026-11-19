import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { socket, API_URL } from '../socket';

function playReadyChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [659.25, 880]; // E5 -> A5 (same chime as Kitchen Display)
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);

      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.36);
    });
  } catch {
    // Ignore autoplay restriction until first user interaction
  }
}

export default function CashierMonitor({ user, onLogout }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState('dine_in'); // 'dine_in' (Restaurant) or 'takeaway'
  const [tables, setTables] = useState([]);
  const [takeawayOrders, setTakeawayOrders] = useState([]);
  const [menu, setMenu] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);

  // Shared theme state across Cashier & Admin Settings via localStorage
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
    columnBg: theme === 'dark' ? '#162032' : '#f1f5f9',
    subCardBg: theme === 'dark' ? '#0f172a' : '#ffffff',
  };

  // Selected target: either a table object (dine_in) or a takeaway order object (or { isNew: true })
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [activeOrderItems, setActiveOrderItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [settings, setSettings] = useState({ store_name: 'Bistro POS', currency_symbol: '€' });

  // Admin "On the House" selection mode states: { [compBaseKey]: quantityToComp }
  const [isOnTheHouseMode, setIsOnTheHouseMode] = useState(false);
  const [compQuantities, setCompQuantities] = useState({});

  // All-staff "Remove Items" selection mode states: { [groupKey]: quantityToRemove }
  const [isRemoveMode, setIsRemoveMode] = useState(false);
  const [removeQuantities, setRemoveQuantities] = useState({});

  // Table Transfer / Merge Modal states
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  // Split Bill Modal states
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitTab, setSplitTab] = useState('even'); // 'even' | 'items'
  const [splitWays, setSplitWays] = useState(2);
  const [splitItemQuantities, setSplitItemQuantities] = useState({});
  const [isSplitting, setIsSplitting] = useState(false);

  const currency = settings.currency_symbol || '€';
  const grossActiveTotal = activeOrderItems.reduce(
    (sum, item) => sum + (item.is_comped ? 0 : parseFloat(item.price) * item.quantity),
    0
  );
  const alreadyPaidAmount = parseFloat(selectedTarget?.already_paid || 0);
  const remainingBalance = Math.max(0, grossActiveTotal - alreadyPaidAmount);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchTables();
    fetchTakeawayOrders();
    fetchMenu();
    fetchSettings();
  }, [user, navigate]);

  const fetchSettings = async () => {
    const res = await axios.get(`${API_URL}/api/settings`);
    if (res.data) setSettings(res.data);
  };

  const fetchTables = async () => {
    const res = await axios.get(`${API_URL}/api/tables`);
    setTables(res.data);
  };

  const fetchTakeawayOrders = async () => {
    const res = await axios.get(`${API_URL}/api/takeaway`);
    setTakeawayOrders(res.data);
  };

  const fetchMenu = async () => {
    const res = await axios.get(`${API_URL}/api/menu`);
    setMenu(res.data);
    if (res.data.length > 0 && !selectedCategory) {
      setSelectedCategory(res.data[0].id);
    }
  };

  const fetchOrderItems = async (orderId) => {
    if (!orderId) {
      setActiveOrderItems([]);
      return;
    }
    const res = await axios.get(`${API_URL}/api/orders/${orderId}`);
    setActiveOrderItems(res.data);
  };

  useEffect(() => {
    const handleRefresh = async () => {
      const [tablesRes, takeawaysRes] = await Promise.all([
        axios.get(`${API_URL}/api/tables`),
        axios.get(`${API_URL}/api/takeaway`),
      ]);
      setTables(tablesRes.data);
      setTakeawayOrders(takeawaysRes.data);

      if (selectedTarget && !selectedTarget.isNew) {
        if (mode === 'dine_in') {
          const updated = tablesRes.data.find((t) => t.id === selectedTarget.id);
          if (updated) {
            setSelectedTarget(updated);
            fetchOrderItems(updated.active_order_id);
          }
        } else {
          const updated = takeawaysRes.data.find((o) => o.id === selectedTarget.id);
          if (updated) {
            setSelectedTarget(updated);
            fetchOrderItems(updated.id);
          }
        }
      }
    };

    const handleTakeawayReady = () => {
      playReadyChime();
      handleRefresh();
    };

    socket.on('tables_updated', handleRefresh);
    socket.on('menu_updated', fetchMenu);
    socket.on('settings_updated', (newSettings) => setSettings(newSettings));
    socket.on('takeaway_order_ready', handleTakeawayReady);
    socket.on('order_item_ready', () => {
      const orderId = mode === 'dine_in' ? selectedTarget?.active_order_id : selectedTarget?.id;
      if (orderId) fetchOrderItems(orderId);
    });

    return () => {
      socket.off('tables_updated', handleRefresh);
      socket.off('menu_updated', fetchMenu);
      socket.off('settings_updated');
      socket.off('takeaway_order_ready', handleTakeawayReady);
      socket.off('order_item_ready');
    };
  }, [selectedTarget, mode]);

  // Normal & Remove Mode grouping: separates paid vs already-comped lines
  const groupedOrderItems = useMemo(() => {
    const groups = [];
    const map = new Map();

    for (const item of activeOrderItems) {
      const key = `${item.name}|${item.price}|${item.notes || ''}|${item.prep_status}|${item.is_comped ? 1 : 0}|${item.is_paid ? 1 : 0}`;
      if (!map.has(key)) {
        const group = {
          key,
          name: item.name,
          price: item.price,
          notes: item.notes,
          prep_status: item.prep_status,
          is_comped: Boolean(item.is_comped),
          is_paid: Boolean(item.is_paid),
          quantity: item.quantity,
          rows: [{ id: item.id, quantity: item.quantity, is_comped: Boolean(item.is_comped), is_paid: Boolean(item.is_paid) }],
        };
        map.set(key, group);
        groups.push(group);
      } else {
        const existing = map.get(key);
        existing.quantity += item.quantity;
        existing.rows.push({ id: item.id, quantity: item.quantity, is_comped: Boolean(item.is_comped), is_paid: Boolean(item.is_paid) });
      }
    }

    return groups;
  }, [activeOrderItems]);

  // Unpaid, non-comped groups eligible for Split-by-Item
  const splittableGroups = useMemo(() => {
    return groupedOrderItems.filter((g) => !g.is_comped && !g.is_paid);
  }, [groupedOrderItems]);

  // On-the-House Mode grouping: merges paid + comped rows of the same item so you can adjust total comped count
  const compGroupedOrderItems = useMemo(() => {
    const groups = [];
    const map = new Map();

    for (const item of activeOrderItems) {
      const key = `${item.name}|${item.price}|${item.notes || ''}|${item.prep_status}`;
      if (!map.has(key)) {
        const group = {
          key,
          name: item.name,
          price: item.price,
          notes: item.notes,
          prep_status: item.prep_status,
          is_comped: Boolean(item.is_comped),
          compedQuantity: item.is_comped ? item.quantity : 0,
          quantity: item.quantity,
          rows: [{ id: item.id, quantity: item.quantity, is_comped: Boolean(item.is_comped) }],
        };
        map.set(key, group);
        groups.push(group);
      } else {
        const existing = map.get(key);
        existing.quantity += item.quantity;
        if (item.is_comped) existing.compedQuantity += item.quantity;
        existing.rows.push({ id: item.id, quantity: item.quantity, is_comped: Boolean(item.is_comped) });
      }
    }

    return groups;
  }, [activeOrderItems]);

  const switchMode = (newMode) => {
    setMode(newMode);
    setSelectedTarget(newMode === 'takeaway' ? { isNew: true } : null);
    setActiveOrderItems([]);
    setCart([]);
    setIsOnTheHouseMode(false);
    setCompQuantities({});
    setIsRemoveMode(false);
    setRemoveQuantities({});
  };

  const handleSelectTable = (table) => {
    setSelectedTarget(table);
    setCart([]);
    setIsOnTheHouseMode(false);
    setCompQuantities({});
    setIsRemoveMode(false);
    setRemoveQuantities({});
    fetchOrderItems(table.active_order_id);
  };

  const handleSelectTakeaway = (order) => {
    setSelectedTarget(order);
    setCart([]);
    setIsOnTheHouseMode(false);
    setCompQuantities({});
    setIsRemoveMode(false);
    setRemoveQuantities({});
    fetchOrderItems(order.id);
  };

  const startNewTakeaway = () => {
    setSelectedTarget({ isNew: true });
    setActiveOrderItems([]);
    setCart([]);
    setIsOnTheHouseMode(false);
    setCompQuantities({});
    setIsRemoveMode(false);
    setRemoveQuantities({});
  };

  const addToCart = (item) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((i) => i.menu_item_id === item.id && !i.notes);
      if (existingIndex > -1) {
        return prev.map((cartItem, idx) =>
          idx === existingIndex
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }
      return [...prev, { menu_item_id: item.id, name: item.name, price: item.price, quantity: 1, notes: '' }];
    });
  };

  const updateCartNote = (index, note) => {
    setCart((prev) => prev.map((item, idx) => (idx === index ? { ...item, notes: note } : item)));
  };

  const removeCartItem = (index) => {
    setCart((prev) => prev.filter((_, idx) => idx !== index));
  };

  const sendOrderToKitchen = async () => {
    if (!selectedTarget || cart.length === 0) return;

    if (mode === 'dine_in') {
      await axios.post(`${API_URL}/api/orders`, {
        table_id: selectedTarget.id,
        order_type: 'dine_in',
        user_id: user.id,
        items: cart,
      });
      setCart([]);
      const updatedTables = await axios.get(`${API_URL}/api/tables`);
      setTables(updatedTables.data);
      const refreshed = updatedTables.data.find((t) => t.id === selectedTarget.id);
      setSelectedTarget(refreshed);
      fetchOrderItems(refreshed.active_order_id);
    } else {
      const res = await axios.post(`${API_URL}/api/orders`, {
        order_id: selectedTarget.isNew ? null : selectedTarget.id,
        order_type: 'takeaway',
        user_id: user.id,
        items: cart,
      });
      setCart([]);
      const updatedTakeaways = await axios.get(`${API_URL}/api/takeaway`);
      setTakeawayOrders(updatedTakeaways.data);
      const refreshed = updatedTakeaways.data.find((o) => o.id === res.data.orderId);
      setSelectedTarget(refreshed);
      fetchOrderItems(res.data.orderId);
    }
  };

  const handleCheckout = async (method) => {
    const orderId = mode === 'dine_in' ? selectedTarget?.active_order_id : selectedTarget?.id;
    if (!orderId) return;

    await axios.post(`${API_URL}/api/orders/${orderId}/pay`, {
      amount: remainingBalance,
      method,
    });

    setSelectedTarget(mode === 'takeaway' ? { isNew: true } : null);
    setActiveOrderItems([]);
    setIsOnTheHouseMode(false);
    setCompQuantities({});
    setIsRemoveMode(false);
    setRemoveQuantities({});
    fetchTables();
    fetchTakeawayOrders();
  };

  const handleCancelOrder = async () => {
    const orderId = mode === 'dine_in' ? selectedTarget?.active_order_id : selectedTarget?.id;
    if (!orderId) return;

    await axios.post(`${API_URL}/api/orders/${orderId}/cancel`);

    setSelectedTarget(mode === 'takeaway' ? { isNew: true } : null);
    setActiveOrderItems([]);
    setIsOnTheHouseMode(false);
    setCompQuantities({});
    setIsRemoveMode(false);
    setRemoveQuantities({});
    fetchTables();
    fetchTakeawayOrders();
  };

  // --- TABLE TRANSFER / MERGE HANDLER ---
  const handleTransferToTable = async (targetTable) => {
    const orderId = selectedTarget?.active_order_id;
    if (!orderId || isTransferring) return;

    if (targetTable.status === 'occupied') {
      const confirmed = window.confirm(
        `${targetTable.table_number} already has active Order #${targetTable.daily_number}.\n\nMerge ${selectedTarget.table_number}'s items into ${targetTable.table_number}?`
      );
      if (!confirmed) return;
    }

    setIsTransferring(true);
    try {
      await axios.post(`${API_URL}/api/orders/${orderId}/transfer`, {
        target_table_id: targetTable.id,
      });
      const updatedTables = await axios.get(`${API_URL}/api/tables`);
      setTables(updatedTables.data);
      const refreshedDest = updatedTables.data.find((t) => t.id === targetTable.id);
      setSelectedTarget(refreshedDest || null);
      if (refreshedDest?.active_order_id) {
        fetchOrderItems(refreshedDest.active_order_id);
      }
      setShowTransferModal(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to transfer table');
    } finally {
      setIsTransferring(false);
    }
  };

  // --- SPLIT BILL HANDLERS ---
  const openSplitModal = () => {
    setSplitTab('even');
    setSplitWays(2);
    setSplitItemQuantities({});
    setShowSplitModal(true);
  };

  const toggleSplitItem = (group) => {
    setSplitItemQuantities((prev) => {
      const updated = { ...prev };
      if (updated[group.key]) {
        delete updated[group.key];
      } else {
        updated[group.key] = group.quantity;
      }
      return updated;
    });
  };

  const updateSplitItemQty = (e, group, delta) => {
    e.stopPropagation();
    setSplitItemQuantities((prev) => {
      const current = prev[group.key] || 0;
      const next = current + delta;
      const updated = { ...prev };
      if (next <= 0) {
        delete updated[group.key];
      } else {
        updated[group.key] = Math.min(next, group.quantity);
      }
      return updated;
    });
  };

  const splitByItemsTotal = useMemo(() => {
    let sum = 0;
    for (const group of splittableGroups) {
      const qty = splitItemQuantities[group.key] || 0;
      sum += qty * parseFloat(group.price);
    }
    return Math.min(sum, remainingBalance);
  }, [splittableGroups, splitItemQuantities, remainingBalance]);

  const handleConfirmSplitPay = async (method) => {
    const orderId = mode === 'dine_in' ? selectedTarget?.active_order_id : selectedTarget?.id;
    if (!orderId || isSplitting) return;

    const amountToPay =
      splitTab === 'even'
        ? parseFloat((remainingBalance / Math.max(2, splitWays)).toFixed(2))
        : parseFloat(splitByItemsTotal.toFixed(2));

    if (amountToPay <= 0) return;

    const paidItemsPayload = [];
    if (splitTab === 'items') {
      for (const group of splittableGroups) {
        let remainingToMark = splitItemQuantities[group.key] || 0;
        if (remainingToMark <= 0) continue;

        for (const row of group.rows) {
          if (remainingToMark <= 0) break;
          const take = Math.min(remainingToMark, row.quantity);
          paidItemsPayload.push({ id: row.id, quantity: take });
          remainingToMark -= take;
        }
      }
    }

    setIsSplitting(true);
    try {
      const res = await axios.post(`${API_URL}/api/orders/${orderId}/split-pay`, {
        amount: amountToPay,
        method,
        paid_items: paidItemsPayload,
      });

      const [updatedTables, updatedTakeaways] = await Promise.all([
        axios.get(`${API_URL}/api/tables`),
        axios.get(`${API_URL}/api/takeaway`),
      ]);
      setTables(updatedTables.data);
      setTakeawayOrders(updatedTakeaways.data);

      if (res.data.orderClosed) {
        setShowSplitModal(false);
        setSelectedTarget(mode === 'takeaway' ? { isNew: true } : null);
        setActiveOrderItems([]);
      } else {
        setSplitItemQuantities({});
        if (splitTab === 'even' && splitWays > 2) {
          setSplitWays((w) => w - 1);
        }
        if (mode === 'dine_in') {
          const refreshed = updatedTables.data.find((t) => t.id === selectedTarget.id);
          setSelectedTarget(refreshed);
        } else {
          const refreshed = updatedTakeaways.data.find((o) => o.id === selectedTarget.id);
          setSelectedTarget(refreshed);
        }
        fetchOrderItems(orderId);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Split payment failed');
    } finally {
      setIsSplitting(false);
    }
  };

  // --- ON THE HOUSE HANDLERS ---
  const enterOnTheHouseMode = () => {
    const initialComps = {};
    for (const group of compGroupedOrderItems) {
      if (group.compedQuantity > 0) {
        initialComps[group.key] = group.compedQuantity;
      }
    }
    setCompQuantities(initialComps);
    setIsRemoveMode(false);
    setIsOnTheHouseMode(true);
  };

  const toggleGroupCompSelection = (group) => {
    setCompQuantities((prev) => {
      const updated = { ...prev };
      if (updated[group.key]) {
        delete updated[group.key];
      } else {
        updated[group.key] = group.quantity;
      }
      return updated;
    });
  };

  const updateCompQty = (e, group, delta) => {
    e.stopPropagation();
    setCompQuantities((prev) => {
      const current = prev[group.key] || 0;
      const next = current + delta;
      const updated = { ...prev };
      if (next <= 0) {
        delete updated[group.key];
      } else {
        updated[group.key] = Math.min(next, group.quantity);
      }
      return updated;
    });
  };

  const confirmOnTheHouse = async () => {
    const orderId = mode === 'dine_in' ? selectedTarget?.active_order_id : selectedTarget?.id;
    if (!orderId) return;

    const itemsPayload = [];
    for (const group of compGroupedOrderItems) {
      let remainingToComp = compQuantities[group.key] || 0;
      if (remainingToComp <= 0) continue;

      const orderedRows = [...group.rows].sort((a, b) => (b.is_comped ? 1 : 0) - (a.is_comped ? 1 : 0));
      for (const row of orderedRows) {
        if (remainingToComp <= 0) break;
        const take = Math.min(remainingToComp, row.quantity);
        itemsPayload.push({ id: row.id, quantity: take });
        remainingToComp -= take;
      }
    }

    await axios.post(`${API_URL}/api/orders/${orderId}/on-the-house`, {
      items: itemsPayload,
    });

    setIsOnTheHouseMode(false);
    setCompQuantities({});
    fetchOrderItems(orderId);
    fetchTables();
    fetchTakeawayOrders();
  };

  // --- REMOVE ITEMS HANDLERS ---
  const enterRemoveMode = () => {
    setRemoveQuantities({});
    setIsOnTheHouseMode(false);
    setIsRemoveMode(true);
  };

  const toggleRemoveSelection = (group) => {
    setRemoveQuantities((prev) => {
      const updated = { ...prev };
      if (updated[group.key]) {
        delete updated[group.key];
      } else {
        updated[group.key] = group.quantity;
      }
      return updated;
    });
  };

  const updateRemoveQty = (e, group, delta) => {
    e.stopPropagation();
    setRemoveQuantities((prev) => {
      const current = prev[group.key] || 0;
      const next = current + delta;
      const updated = { ...prev };
      if (next <= 0) {
        delete updated[group.key];
      } else {
        updated[group.key] = Math.min(next, group.quantity);
      }
      return updated;
    });
  };

  const confirmRemoveItems = async () => {
    const orderId = mode === 'dine_in' ? selectedTarget?.active_order_id : selectedTarget?.id;
    const itemsPayload = [];

    for (const group of groupedOrderItems) {
      let remainingToRemove = removeQuantities[group.key] || 0;
      if (remainingToRemove <= 0) continue;

      for (const row of group.rows) {
        if (remainingToRemove <= 0) break;
        const take = Math.min(remainingToRemove, row.quantity);
        itemsPayload.push({ id: row.id, quantity: take });
        remainingToRemove -= take;
      }
    }

    if (!orderId || itemsPayload.length === 0) return;

    await axios.post(`${API_URL}/api/orders/${orderId}/cancel-items`, {
      items: itemsPayload,
    });

    setIsRemoveMode(false);
    setRemoveQuantities({});

    const itemsRes = await axios.get(`${API_URL}/api/orders/${orderId}`);
    setActiveOrderItems(itemsRes.data);

    if (itemsRes.data.length === 0) {
      if (mode === 'dine_in') {
        const updatedTables = await axios.get(`${API_URL}/api/tables`);
        setTables(updatedTables.data);
        const refreshed = updatedTables.data.find((t) => t.id === selectedTarget.id);
        setSelectedTarget(refreshed || null);
      } else {
        setSelectedTarget({ isNew: true });
      }
    }

    fetchTables();
    fetchTakeawayOrders();
  };

  if (!user) return null;

  const currentCategoryItems = menu.find((c) => c.id === selectedCategory)?.items || [];
  const isSelectionMode = isOnTheHouseMode || isRemoveMode;
  const displayedGroups = isOnTheHouseMode ? compGroupedOrderItems : groupedOrderItems;
  const totalSelectedToRemove = Object.values(removeQuantities).reduce((sum, q) => sum + q, 0);
  const totalSelectedToComp = Object.values(compQuantities).reduce((sum, q) => sum + q, 0);
  const hasActiveDineInOrder = mode === 'dine_in' && Boolean(selectedTarget?.active_order_id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg, color: t.textMain, overflow: 'hidden' }}>
      {/* TOP NAVIGATION BAR */}
      <header style={{
        height: '64px',
        flexShrink: 0,
        background: t.cardBg,
        borderBottom: `1px solid ${t.border}`,
        padding: '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span style={{ fontSize: '20px', fontWeight: '800', color: '#38bdf8' }}>
            {settings.store_name}
          </span>

          <div style={{
            display: 'flex',
            background: t.subCardBg,
            padding: '4px',
            borderRadius: '10px',
            border: `1px solid ${t.border}`,
            gap: '4px',
          }}>
            <button
              onClick={() => switchMode('dine_in')}
              style={{
                padding: '7px 16px',
                borderRadius: '7px',
                border: 'none',
                background: mode === 'dine_in' ? '#0284c7' : 'transparent',
                color: mode === 'dine_in' ? '#fff' : t.textMuted,
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              🍽️ Restaurant
            </button>
            <button
              onClick={() => switchMode('takeaway')}
              style={{
                padding: '7px 16px',
                borderRadius: '7px',
                border: 'none',
                background: mode === 'takeaway' ? '#f59e0b' : 'transparent',
                color: mode === 'takeaway' ? '#0f172a' : t.textMuted,
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              🛍️ Takeaway ({takeawayOrders.length})
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ textAlign: 'right', marginRight: '8px' }}>
            <div style={{ fontSize: '14px', fontWeight: '600' }}>{user.name}</div>
            <div style={{ fontSize: '11px', color: '#38bdf8', textTransform: 'uppercase', fontWeight: '700' }}>
              {user.role}
            </div>
          </div>

          {/* THEME TOGGLE BUTTON */}
          <button
            onClick={toggleTheme}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: `1px solid ${t.border}`,
              background: t.subCardBg,
              color: t.textMain,
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>

          {user.role === 'admin' && (
            <button
              onClick={() => navigate('/admin')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#8b5cf6',
                color: '#fff',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              ⚙ Admin Settings
            </button>
          )}

          <button
            onClick={onLogout}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: `1px solid ${t.border}`,
              background: t.subCardBg,
              color: t.textMain,
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Lock / Switch User
          </button>
        </div>
      </header>

      {/* MAIN 3-COLUMN WORKSPACE */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* COLUMN 1: FLOOR PLAN OR TAKEAWAY QUEUE */}
        <div style={{ flex: '0 0 28%', padding: '18px', borderRight: `1px solid ${t.border}`, overflowY: 'auto' }}>
          {mode === 'dine_in' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '16px', color: t.textMain }}>Floor Plan</h2>
                <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: t.textMuted }}>
                  <span><strong style={{ color: '#38bdf8' }}>●</strong> Free</span>
                  <span><strong style={{ color: '#f59e0b' }}>●</strong> Busy</span>
                  <span><strong style={{ color: '#10b981' }}>●</strong> Ready</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {tables.map((table) => {
                  const isSelected = selectedTarget?.id === table.id;
                  const isOccupied = table.status === 'occupied';
                  const isReady = isOccupied && Boolean(table.is_ready);

                  const cardBg = !isOccupied
                    ? 'rgba(2, 132, 199, 0.16)'
                    : isReady
                    ? 'rgba(16, 185, 129, 0.18)'
                    : 'rgba(245, 158, 11, 0.15)';

                  const cardBorder = isSelected
                    ? `2px solid ${t.textMain}`
                    : !isOccupied
                    ? '1px solid rgba(56, 189, 248, 0.45)'
                    : isReady
                    ? '1px solid rgba(16, 185, 129, 0.55)'
                    : '1px solid rgba(245, 158, 11, 0.4)';

                  const statusColor = !isOccupied
                    ? '#38bdf8'
                    : isReady
                    ? '#34d399'
                    : '#fbbf24';

                  return (
                    <div
                      key={table.id}
                      onClick={() => handleSelectTable(table)}
                      style={{
                        padding: '16px 10px',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        textAlign: 'center',
                        background: cardBg,
                        border: cardBorder,
                      }}
                    >
                      <div style={{ fontSize: '16px', fontWeight: '700', color: t.textMain }}>
                        {table.table_number}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        fontWeight: '800',
                        marginTop: '4px',
                        textTransform: 'uppercase',
                        color: statusColor,
                      }}>
                        {!isOccupied
                          ? 'Free'
                          : isReady
                          ? `✓ Ready (#${table.daily_number})`
                          : `Order #${table.daily_number}`}
                      </div>
                      {isOccupied && (
                        <div style={{ marginTop: '6px', fontSize: '14px', fontWeight: '800', color: t.textMain }}>
                          {currency}{parseFloat(table.current_total || 0).toFixed(2)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '16px', color: t.textMain }}>Takeaways</h2>
                <button
                  onClick={startNewTakeaway}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#f59e0b',
                    color: '#0f172a',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  + New
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                {takeawayOrders.length === 0 ? (
                  <div style={{ color: t.textMuted, fontSize: '13px', padding: '16px 0' }}>
                    No unpaid takeaway orders. Add items to start one.
                  </div>
                ) : (
                  takeawayOrders.map((order) => {
                    const isSelected = selectedTarget?.id === order.id && !selectedTarget?.isNew;
                    const isReady = Boolean(order.is_ready);
                    return (
                      <div
                        key={order.id}
                        onClick={() => handleSelectTakeaway(order)}
                        style={{
                          padding: '14px',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          background: isReady
                            ? 'rgba(16, 185, 129, 0.18)'
                            : 'rgba(245, 158, 11, 0.15)',
                          border: isSelected
                            ? `2px solid ${isReady ? '#10b981' : '#f59e0b'}`
                            : isReady
                            ? '1px solid rgba(16, 185, 129, 0.55)'
                            : '1px solid rgba(245, 158, 11, 0.4)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                              fontSize: '16px',
                              fontWeight: '800',
                              color: isReady ? '#34d399' : '#fbbf24',
                            }}>
                              Order #{order.daily_number}
                            </span>
                            {isReady && (
                              <span style={{
                                fontSize: '10px',
                                fontWeight: '800',
                                padding: '2px 7px',
                                borderRadius: '999px',
                                background: '#10b981',
                                color: '#064e3b',
                                letterSpacing: '0.5px',
                              }}>
                                ✓ READY
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px' }}>
                            {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div style={{ fontSize: '15px', fontWeight: '800', color: t.textMain }}>
                          {currency}{parseFloat(order.current_total || 0).toFixed(2)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* COLUMNS 2 & 3: MENU BROWSER + ACTIVE TICKET */}
        {!selectedTarget ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: t.cardBg, color: t.textMuted }}>
            <div style={{ fontSize: '42px', marginBottom: '10px' }}>🍽️</div>
            <div style={{ fontSize: '18px', fontWeight: '600', color: t.textMuted }}>No Table Selected</div>
            <div style={{ fontSize: '14px', marginTop: '4px' }}>Tap a table on the left to take an order or settle a bill.</div>
          </div>
        ) : (
          <>
            {/* COLUMN 2: SCROLLABLE MENU CATEGORIES & ITEMS */}
            <div style={{
              flex: '1 1 36%',
              padding: '18px',
              background: t.cardBg,
              borderRight: `1px solid ${t.border}`,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', marginBottom: '10px' }}>
                Menu
              </div>

              {/* CATEGORY TABS */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px', flexShrink: 0 }}>
                {menu.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    style={{
                      padding: '7px 13px',
                      borderRadius: '8px',
                      border: `1px solid ${t.border}`,
                      background: selectedCategory === cat.id ? '#0284c7' : (theme === 'dark' ? '#0f172a' : '#e2e8f0'),
                      color: selectedCategory === cat.id ? '#fff' : t.textMain,
                      fontWeight: '600',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {/* SCROLLABLE MENU ITEM GRID */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                alignContent: 'start',
                paddingRight: '4px',
              }}>
                {currentCategoryItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    style={{
                      padding: '12px 10px',
                      borderRadius: '10px',
                      border: `1px solid ${theme === 'dark' ? '#334155' : '#cbd5e1'}`,
                      background: theme === 'dark' ? '#0f172a' : '#f1f5f9',
                      color: t.textMain,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: '66px',
                      boxShadow: theme === 'light' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                    }}
                  >
                    <div style={{ fontWeight: '600', fontSize: '13px', lineHeight: '1.25' }}>{item.name}</div>
                    <div style={{ color: '#0284c7', fontWeight: '700', fontSize: '13px', marginTop: '6px' }}>
                      {currency}{parseFloat(item.price).toFixed(2)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* COLUMN 3: UNSENT CART + ACTIVE ORDER ITEMS + CHECKOUT FOOTER */}
            <div style={{
              flex: '1 1 36%',
              padding: '18px',
              background: t.columnBg,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              {/* TICKET HEADER + TABLE TRANSFER BUTTON */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0, gap: '8px' }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: '800', color: t.textMain }}>
                    {mode === 'dine_in'
                      ? selectedTarget.table_number
                      : selectedTarget.isNew
                      ? 'New Takeaway'
                      : `Takeaway #${selectedTarget.daily_number}`}
                  </h2>
                  <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: '700' }}>
                    {selectedTarget.daily_number ? `Ticket #${selectedTarget.daily_number}` : 'New Ticket'}
                  </span>
                </div>

                {hasActiveDineInOrder && (
                  <button
                    onClick={() => setShowTransferModal(true)}
                    style={{
                      padding: '7px 12px',
                      borderRadius: '8px',
                      border: '1px solid #38bdf8',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontWeight: '700',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    ⇄ Transfer / Merge
                  </button>
                )}
              </div>

              {/* UNSENT CART ITEMS */}
              {cart.length > 0 && (
                <div style={{
                  background: 'rgba(2, 132, 199, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  padding: '12px',
                  borderRadius: '12px',
                  marginBottom: '12px',
                  flexShrink: 0,
                  maxHeight: '34%',
                  display: 'flex',
                  flexDirection: 'column',
                }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#38bdf8', marginBottom: '8px', textTransform: 'uppercase' }}>
                    New Items to Send ({cart.reduce((s, i) => s + i.quantity, 0)})
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1, marginBottom: '8px' }}>
                    {cart.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: '600', minWidth: '115px', fontSize: '13px', color: t.textMain }}>
                          {item.quantity}x {item.name}
                        </span>
                        <input
                          placeholder="Note..."
                          value={item.notes}
                          onChange={(e) => updateCartNote(idx, e.target.value)}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: '5px 8px',
                            borderRadius: '6px',
                            border: `1px solid ${t.border}`,
                            background: t.subCardBg,
                            color: t.textMain,
                            fontSize: '12px',
                          }}
                        />
                        <button
                          onClick={() => removeCartItem(idx)}
                          style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={sendOrderToKitchen}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: mode === 'takeaway' ? '#f59e0b' : '#0284c7',
                      color: mode === 'takeaway' ? '#0f172a' : '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: '700',
                      fontSize: '13px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Send Order to Kitchen →
                  </button>
                </div>
              )}

              {/* SENT ORDER LEDGER */}
              <div style={{
                flex: 1,
                minHeight: '140px',
                overflowY: 'auto',
                background: t.subCardBg,
                borderRadius: '12px',
                padding: '12px',
                border: isOnTheHouseMode
                  ? '2px solid #a855f7'
                  : isRemoveMode
                  ? '2px solid #ef4444'
                  : `1px solid ${t.border}`,
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '10px',
                  flexWrap: 'wrap',
                }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    color: isOnTheHouseMode ? '#c084fc' : isRemoveMode ? '#f87171' : t.textMuted,
                    textTransform: 'uppercase',
                  }}>
                    {isOnTheHouseMode
                      ? 'Select On the House'
                      : isRemoveMode
                      ? 'Select to Remove'
                      : 'Active Order Items'}
                  </span>

                  {displayedGroups.length > 0 && !isSelectionMode && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={enterRemoveMode}
                        style={{
                          padding: '5px 12px',
                          borderRadius: '6px',
                          border: '1px solid #ef4444',
                          background: theme === 'dark' ? 'rgba(239, 68, 68, 0.18)' : '#fee2e2',
                          color: theme === 'dark' ? '#fca5a5' : '#991b1b',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer',
                        }}
                      >
                        🗑️ Remove
                      </button>

                      {user.role === 'admin' && (
                        <button
                          onClick={enterOnTheHouseMode}
                          style={{
                            padding: '5px 12px',
                            borderRadius: '6px',
                            border: '1px solid #a855f7',
                            background: theme === 'dark' ? 'rgba(168, 85, 247, 0.2)' : '#f3e8ff',
                            color: theme === 'dark' ? '#e9d5ff' : '#6b21a8',
                            fontSize: '11px',
                            fontWeight: '700',
                            cursor: 'pointer',
                          }}
                        >
                          🎁 On the House
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {displayedGroups.length === 0 ? (
                  <div style={{ color: t.textMuted, fontSize: '13px', padding: '12px 0' }}>
                    No items sent to kitchen yet.
                  </div>
                ) : (
                  displayedGroups.map((group) => {
                    const selectedQty = isOnTheHouseMode
                      ? compQuantities[group.key] || 0
                      : isRemoveMode
                      ? removeQuantities[group.key] || 0
                      : 0;
                    const isChecked = selectedQty > 0;

                    const handleRowClick = () => {
                      if (isOnTheHouseMode) toggleGroupCompSelection(group);
                      if (isRemoveMode) toggleRemoveSelection(group);
                    };

                    const handleStepperChange = (e, delta) => {
                      if (isOnTheHouseMode) updateCompQty(e, group, delta);
                      if (isRemoveMode) updateRemoveQty(e, group, delta);
                    };

                    return (
                      <div
                        key={group.key}
                        onClick={handleRowClick}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 6px',
                          borderRadius: '8px',
                          borderBottom: `1px solid ${t.border}`,
                          cursor: isSelectionMode ? 'pointer' : 'default',
                          opacity: !isSelectionMode && group.is_paid ? 0.65 : 1,
                          background: isChecked
                            ? isOnTheHouseMode
                              ? 'rgba(168, 85, 247, 0.18)'
                              : 'rgba(239, 68, 68, 0.18)'
                            : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          {isSelectionMode && (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{
                                width: '16px',
                                height: '16px',
                                accentColor: isOnTheHouseMode ? '#a855f7' : '#ef4444',
                                cursor: 'pointer',
                                flexShrink: 0,
                              }}
                            />
                          )}

                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: '600', fontSize: '13px', color: t.textMain }}>
                              {group.quantity}x {group.name}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
                              <span style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '10px',
                                fontWeight: '700',
                                background: group.prep_status === 'ready' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                color: group.prep_status === 'ready' ? '#34d399' : '#fbbf24',
                              }}>
                                {group.prep_status.toUpperCase()}
                              </span>
                              {group.is_paid && !isSelectionMode && (
                                <span style={{
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: '10px',
                                  fontWeight: '800',
                                  background: 'rgba(56, 189, 248, 0.2)',
                                  color: '#38bdf8',
                                }}>
                                  PAID
                                </span>
                              )}
                              {group.is_comped && !isOnTheHouseMode && (
                                <span style={{
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: '10px',
                                  fontWeight: '800',
                                  background: 'rgba(168, 85, 247, 0.25)',
                                  color: '#c084fc',
                                }}>
                                  ON THE HOUSE
                                </span>
                              )}
                            </div>
                            {group.notes && (
                              <div style={{ fontSize: '11px', color: '#f87171', marginTop: '2px' }}>
                                Note: {group.notes}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* RIGHT SIDE: QUANTITY STEPPER + PRICE */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          {isSelectionMode && group.quantity > 1 && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: t.cardBg,
                                padding: '3px 6px',
                                borderRadius: '7px',
                                border: isOnTheHouseMode ? '1px solid #a855f7' : '1px solid #ef4444',
                              }}
                            >
                              <button
                                onClick={(e) => handleStepperChange(e, -1)}
                                style={{
                                  width: '22px',
                                  height: '22px',
                                  borderRadius: '5px',
                                  border: 'none',
                                  background: t.border,
                                  color: t.textMain,
                                  fontWeight: '800',
                                  cursor: 'pointer',
                                }}
                              >
                                −
                              </button>
                              <span style={{
                                fontSize: '12px',
                                fontWeight: '800',
                                color: isOnTheHouseMode ? '#e9d5ff' : '#fca5a5',
                                minWidth: '38px',
                                textAlign: 'center',
                              }}>
                                {selectedQty}/{group.quantity}
                              </span>
                              <button
                                onClick={(e) => handleStepperChange(e, 1)}
                                disabled={selectedQty >= group.quantity}
                                style={{
                                  width: '22px',
                                  height: '22px',
                                  borderRadius: '5px',
                                  border: 'none',
                                  background: selectedQty >= group.quantity
                                    ? t.cardBg
                                    : isOnTheHouseMode
                                    ? '#9333ea'
                                    : '#dc2626',
                                  color: selectedQty >= group.quantity ? t.textMuted : '#fff',
                                  fontWeight: '800',
                                  cursor: selectedQty >= group.quantity ? 'not-allowed' : 'pointer',
                                }}
                              >
                                +
                              </button>
                            </div>
                          )}

                          <div style={{ textAlign: 'right' }}>
                            {!isOnTheHouseMode && group.is_comped ? (
                              <div>
                                <div style={{ fontSize: '11px', textDecoration: 'line-through', color: t.textMuted }}>
                                  {currency}{(parseFloat(group.price) * group.quantity).toFixed(2)}
                                </div>
                                <div style={{ fontWeight: '800', fontSize: '13px', color: '#c084fc' }}>
                                  {currency}0.00
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontWeight: '700', fontSize: '13px', color: t.textMain }}>
                                {currency}{(parseFloat(group.price) * group.quantity).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* CONFIRM / CANCEL BAR WHEN IN ON-THE-HOUSE SELECTION MODE */}
                {isOnTheHouseMode && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button
                      onClick={confirmOnTheHouse}
                      style={{
                        flex: 2,
                        padding: '9px',
                        background: '#9333ea',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '700',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      OK — Comp ({totalSelectedToComp})
                    </button>
                    <button
                      onClick={() => {
                        setIsOnTheHouseMode(false);
                        setCompQuantities({});
                      }}
                      style={{
                        flex: 1,
                        padding: '9px',
                        background: t.border,
                        color: t.textMain,
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* CONFIRM / CANCEL BAR WHEN IN REMOVE ITEMS SELECTION MODE */}
                {isRemoveMode && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button
                      onClick={confirmRemoveItems}
                      disabled={totalSelectedToRemove === 0}
                      style={{
                        flex: 2,
                        padding: '9px',
                        background: totalSelectedToRemove === 0 ? '#7f1d1d' : '#dc2626',
                        color: totalSelectedToRemove === 0 ? '#fca5a5' : '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '700',
                        fontSize: '13px',
                        cursor: totalSelectedToRemove === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      OK — Remove ({totalSelectedToRemove})
                    </button>
                    <button
                      onClick={() => {
                        setIsRemoveMode(false);
                        setRemoveQuantities({});
                      }}
                      style={{
                        flex: 1,
                        padding: '9px',
                        background: t.border,
                        color: t.textMain,
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* PINNED CHECKOUT, SPLIT BILL & CANCEL FOOTER */}
              {groupedOrderItems.length > 0 && (
                <div style={{
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: `1px solid ${t.border}`,
                  flexShrink: '0',
                }}>
                  {alreadyPaidAmount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#34d399', marginBottom: '4px', fontWeight: '700' }}>
                      <span>Already Paid (Split):</span>
                      <span>−{currency}{alreadyPaidAmount.toFixed(2)}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                    <span style={{ fontSize: '13px', color: t.textMuted, fontWeight: '600' }}>
                      {alreadyPaidAmount > 0 ? 'Remaining Due' : 'Total Due'}
                    </span>
                    <span style={{ fontSize: '24px', fontWeight: '800', color: '#38bdf8' }}>
                      {currency}{remainingBalance.toFixed(2)}
                    </span>
                  </div>

                  {/* SPLIT BILL BUTTON */}
                  {remainingBalance > 0 && (
                    <button
                      onClick={openSplitModal}
                      style={{
                        width: '100%',
                        padding: '9px',
                        marginBottom: '8px',
                        background: 'rgba(245, 158, 11, 0.18)',
                        border: '1px solid #f59e0b',
                        color: '#fbbf24',
                        borderRadius: '8px',
                        fontWeight: '800',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      ✂️ Split Bill
                    </button>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    <button
                      onClick={handleCancelOrder}
                      style={{
                        padding: '12px 8px',
                        background: '#dc2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '700',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel Order
                    </button>
                    <button
                      onClick={() => handleCheckout('cash')}
                      style={{
                        padding: '12px 8px',
                        background: '#059669',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '700',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Pay Cash
                    </button>
                    <button
                      onClick={() => handleCheckout('card')}
                      style={{
                        padding: '12px 8px',
                        background: '#0284c7',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '700',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Pay Card
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: TABLE TRANSFER / MERGE                           */}
      {/* ========================================================= */}
      {showTransferModal && selectedTarget && (
        <div
          onClick={() => setShowTransferModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: t.cardBg,
              border: `1px solid ${t.border}`,
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '520px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#38bdf8' }}>
                  ⇄ Transfer or Merge {selectedTarget.table_number}
                </h3>
                <p style={{ fontSize: '13px', color: t.textMuted, marginTop: '4px' }}>
                  Tap a <strong style={{ color: '#38bdf8' }}>Free</strong> table to move Order #{selectedTarget.daily_number}, or tap an <strong style={{ color: '#fbbf24' }}>Occupied</strong> table to merge bills.
                </p>
              </div>
              <button
                onClick={() => setShowTransferModal(false)}
                style={{ background: 'transparent', border: 'none', color: t.textMuted, fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px',
              maxHeight: '340px',
              overflowY: 'auto',
              marginTop: '14px',
            }}>
              {tables
                .filter((tObj) => tObj.id !== selectedTarget.id)
                .map((table) => {
                  const isOccupied = table.status === 'occupied';
                  return (
                    <button
                      key={table.id}
                      disabled={isTransferring}
                      onClick={() => handleTransferToTable(table)}
                      style={{
                        padding: '14px 10px',
                        borderRadius: '12px',
                        cursor: isTransferring ? 'not-allowed' : 'pointer',
                        background: isOccupied ? 'rgba(245, 158, 11, 0.16)' : 'rgba(2, 132, 199, 0.16)',
                        border: isOccupied
                          ? '1px solid rgba(245, 158, 11, 0.45)'
                          : '1px solid rgba(56, 189, 248, 0.45)',
                        color: t.textMain,
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '15px', fontWeight: '800' }}>{table.table_number}</div>
                      <div style={{
                        fontSize: '10px',
                        fontWeight: '800',
                        marginTop: '4px',
                        textTransform: 'uppercase',
                        color: isOccupied ? '#fbbf24' : '#38bdf8',
                      }}>
                        {isOccupied ? `Merge (#${table.daily_number})` : 'Move Here'}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: SPLIT BILL (EVENLY OR BY ITEM)                   */}
      {/* ========================================================= */}
      {showSplitModal && selectedTarget && (
        <div
          onClick={() => setShowSplitModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.82)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: t.cardBg,
              border: `1px solid ${t.border}`,
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '500px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.55)',
            }}
          >
            {/* MODAL HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '19px', fontWeight: '800', color: '#fbbf24' }}>
                  ✂️ Split Bill — Ticket #{selectedTarget.daily_number}
                </h3>
                <div style={{ fontSize: '13px', color: t.textMuted, marginTop: '2px' }}>
                  Remaining Balance: <strong style={{ color: '#38bdf8' }}>{currency}{remainingBalance.toFixed(2)}</strong>
                </div>
              </div>
              <button
                onClick={() => setShowSplitModal(false)}
                style={{ background: 'transparent', border: 'none', color: t.textMuted, fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* MODE TABS */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              background: t.subCardBg,
              padding: '5px',
              borderRadius: '10px',
              marginBottom: '16px',
            }}>
              <button
                onClick={() => setSplitTab('even')}
                style={{
                  padding: '9px',
                  borderRadius: '7px',
                  border: 'none',
                  background: splitTab === 'even' ? '#0284c7' : 'transparent',
                  color: splitTab === 'even' ? '#fff' : t.textMuted,
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                ➗ Split Evenly
              </button>
              <button
                onClick={() => setSplitTab('items')}
                style={{
                  padding: '9px',
                  borderRadius: '7px',
                  border: 'none',
                  background: splitTab === 'items' ? '#0284c7' : 'transparent',
                  color: splitTab === 'items' ? '#fff' : t.textMuted,
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                🧾 Split by Item
              </button>
            </div>

            {/* TAB A: SPLIT EVENLY */}
            {splitTab === 'even' && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: t.textMuted, marginBottom: '8px', textTransform: 'uppercase' }}>
                  Number of Guests / Shares
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
                  {[2, 3, 4, 5, 6].map((num) => (
                    <button
                      key={num}
                      onClick={() => setSplitWays(num)}
                      style={{
                        flex: 1,
                        padding: '12px 0',
                        borderRadius: '10px',
                        border: splitWays === num ? '2px solid #38bdf8' : `1px solid ${t.border}`,
                        background: splitWays === num ? 'rgba(56, 189, 248, 0.2)' : t.subCardBg,
                        color: t.textMain,
                        fontWeight: '800',
                        fontSize: '16px',
                        cursor: 'pointer',
                      }}
                    >
                      {num}
                    </button>
                  ))}
                </div>

                <div style={{
                  background: t.subCardBg,
                  border: `1px solid ${t.border}`,
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center',
                  marginBottom: '18px',
                }}>
                  <div style={{ fontSize: '12px', color: t.textMuted, fontWeight: '700' }}>
                    AMOUNT FOR 1 SHARE (1 / {splitWays})
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: '800', color: '#34d399', marginTop: '4px' }}>
                    {currency}{(remainingBalance / splitWays).toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* TAB B: SPLIT BY ITEM */}
            {splitTab === 'items' && (
              <div>
                <div style={{
                  maxHeight: '240px',
                  overflowY: 'auto',
                  background: t.subCardBg,
                  border: `1px solid ${t.border}`,
                  borderRadius: '12px',
                  padding: '10px',
                  marginBottom: '14px',
                }}>
                  {splittableGroups.length === 0 ? (
                    <div style={{ color: t.textMuted, fontSize: '13px', padding: '12px', textAlign: 'center' }}>
                      No remaining unpaid items to select.
                    </div>
                  ) : (
                    splittableGroups.map((group) => {
                      const selectedQty = splitItemQuantities[group.key] || 0;
                      const isChecked = selectedQty > 0;
                      return (
                        <div
                          key={group.key}
                          onClick={() => toggleSplitItem(group)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px',
                            borderRadius: '8px',
                            borderBottom: `1px solid ${t.border}`,
                            cursor: 'pointer',
                            background: isChecked ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ width: '16px', height: '16px', accentColor: '#38bdf8' }}
                            />
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '700', color: t.textMain }}>
                                {group.quantity}x {group.name}
                              </div>
                              <div style={{ fontSize: '11px', color: t.textMuted }}>
                                {currency}{parseFloat(group.price).toFixed(2)} each
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {group.quantity > 1 && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: t.cardBg,
                                  padding: '3px 6px',
                                  borderRadius: '7px',
                                  border: '1px solid #38bdf8',
                                }}
                              >
                                <button
                                  onClick={(e) => updateSplitItemQty(e, group, -1)}
                                  style={{
                                    width: '22px',
                                    height: '22px',
                                    borderRadius: '5px',
                                    border: 'none',
                                    background: t.border,
                                    color: t.textMain,
                                    fontWeight: '800',
                                    cursor: 'pointer',
                                  }}
                                >
                                  −
                                </button>
                                <span style={{ fontSize: '12px', fontWeight: '800', minWidth: '36px', textAlign: 'center', color: t.textMain }}>
                                  {selectedQty}/{group.quantity}
                                </span>
                                <button
                                  onClick={(e) => updateSplitItemQty(e, group, 1)}
                                  disabled={selectedQty >= group.quantity}
                                  style={{
                                    width: '22px',
                                    height: '22px',
                                    borderRadius: '5px',
                                    border: 'none',
                                    background: selectedQty >= group.quantity ? t.cardBg : '#0284c7',
                                    color: selectedQty >= group.quantity ? t.textMuted : '#fff',
                                    fontWeight: '800',
                                    cursor: selectedQty >= group.quantity ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  +
                                </button>
                              </div>
                            )}

                            <span style={{ fontWeight: '800', fontSize: '13px', color: '#38bdf8' }}>
                              {currency}{(selectedQty * parseFloat(group.price)).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: t.subCardBg,
                  padding: '12px 16px',
                  borderRadius: '10px',
                  marginBottom: '16px',
                }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: t.textMuted }}>Selected Share Total</span>
                  <span style={{ fontSize: '22px', fontWeight: '800', color: '#34d399' }}>
                    {currency}{splitByItemsTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* PAY SHARE BUTTONS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                disabled={isSplitting || (splitTab === 'items' && splitByItemsTotal <= 0)}
                onClick={() => handleConfirmSplitPay('cash')}
                style={{
                  padding: '13px',
                  borderRadius: '10px',
                  border: 'none',
                  background: splitTab === 'items' && splitByItemsTotal <= 0 ? t.border : '#059669',
                  color: splitTab === 'items' && splitByItemsTotal <= 0 ? t.textMuted : '#fff',
                  fontWeight: '800',
                  fontSize: '14px',
                  cursor: splitTab === 'items' && splitByItemsTotal <= 0 ? 'not-allowed' : 'pointer',
                }}
              >
                💵 Pay Share Cash
              </button>
              <button
                disabled={isSplitting || (splitTab === 'items' && splitByItemsTotal <= 0)}
                onClick={() => handleConfirmSplitPay('card')}
                style={{
                  padding: '13px',
                  borderRadius: '10px',
                  border: 'none',
                  background: splitTab === 'items' && splitByItemsTotal <= 0 ? t.border : '#0284c7',
                  color: splitTab === 'items' && splitByItemsTotal <= 0 ? t.textMuted : '#fff',
                  fontWeight: '800',
                  fontSize: '14px',
                  cursor: splitTab === 'items' && splitByItemsTotal <= 0 ? 'not-allowed' : 'pointer',
                }}
              >
                💳 Pay Share Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}