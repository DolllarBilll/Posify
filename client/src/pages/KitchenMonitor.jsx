import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { socket, API_URL } from '../socket';

// Clean two-tone Web Audio chime for new tickets (no external MP3 file needed)
function playNewOrderChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [659.25, 880]; // E5 -> A5
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
    // Ignore browser autoplay restrictions until first user interaction
  }
}

export default function KitchenMonitor() {
  const [tickets, setTickets] = useState([]);
  const [stationFilter, setStationFilter] = useState('all'); // 'all' | 'kitchen' | 'bar'
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [recentlyCompleted, setRecentlyCompleted] = useState([]);
  const [showRecallDrawer, setShowRecallDrawer] = useState(false);

  // Independent local theme state for Kitchen Monitor
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('kitchen_theme') || 'dark';
  });

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('kitchen_theme', nextTheme);
  };

  // Dynamic Theme Palette Dictionary
  const t = {
    bg: theme === 'dark' ? '#0f172a' : '#f8fafc',
    cardBg: theme === 'dark' ? '#1e293b' : '#ffffff',
    textMain: theme === 'dark' ? '#f8fafc' : '#0f172a',
    textMuted: theme === 'dark' ? '#94a3b8' : '#64748b',
    border: theme === 'dark' ? '#334155' : '#cbd5e1',
    subCardBg: theme === 'dark' ? '#0f172a' : '#f1f5f9',
    itemBg: theme === 'dark' ? 'rgba(15, 23, 42, 0.45)' : 'rgba(241, 245, 249, 0.8)',
  };

  const knownItemIdsRef = useRef(new Set());
  const isInitialLoadRef = useRef(true);
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const fetchTickets = async () => {
    const res = await axios.get(`${API_URL}/api/kitchen/tickets`);
    const incoming = res.data;

    // Detect brand-new active items and play chime
    if (!isInitialLoadRef.current) {
      const hasNewActiveItem = incoming.some(
        (item) => item.prep_status !== 'cancelled' && !knownItemIdsRef.current.has(item.item_id)
      );
      if (hasNewActiveItem && soundEnabledRef.current) {
        playNewOrderChime();
      }
    }

    knownItemIdsRef.current = new Set(incoming.map((i) => i.item_id));
    isInitialLoadRef.current = false;
    setTickets(incoming);
  };

  useEffect(() => {
    fetchTickets();
    socket.on('kitchen_updated', fetchTickets);

    // Live 1-second timer tick for elapsed prep time badges
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      socket.off('kitchen_updated', fetchTickets);
      clearInterval(timer);
    };
  }, []);

  const addToRecallHistory = (itemsList) => {
    const valid = itemsList.filter((i) => i.prep_status !== 'cancelled');
    if (valid.length === 0) return;
    setRecentlyCompleted((prev) => {
      const stamped = valid.map((item) => ({
        ...item,
        completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
      return [...stamped, ...prev].slice(0, 12);
    });
  };

  const markItemReady = async (item) => {
    addToRecallHistory([item]);
    await axios.patch(`${API_URL}/api/order-items/${item.item_id}/status`, {
      prep_status: 'ready',
    });
    fetchTickets();
  };

  const bumpAllReadyInOrder = async (items) => {
    const activeItems = items.filter((i) => i.prep_status !== 'cancelled');
    if (activeItems.length === 0) return;

    addToRecallHistory(activeItems);
    await Promise.all(
      activeItems.map((i) =>
        axios.patch(`${API_URL}/api/order-items/${i.item_id}/status`, {
          prep_status: 'ready',
        })
      )
    );
    fetchTickets();
  };

  const handleRecallItem = async (recalledItem) => {
    await axios.patch(`${API_URL}/api/order-items/${recalledItem.item_id}/status`, {
      prep_status: 'pending',
    });
    setRecentlyCompleted((prev) => prev.filter((i) => i.item_id !== recalledItem.item_id));
    fetchTickets();
  };

  const dismissCancelledItem = async (itemId) => {
    await axios.patch(`${API_URL}/api/order-items/${itemId}/status`, {
      prep_status: 'dismissed',
    });
    fetchTickets();
  };

  const dismissAllCancelledInOrder = async (items) => {
    await Promise.all(
      items
        .filter((i) => i.prep_status === 'cancelled')
        .map((i) =>
          axios.patch(`${API_URL}/api/order-items/${i.item_id}/status`, {
            prep_status: 'dismissed',
          })
        )
    );
    fetchTickets();
  };

  // Filter items by selected station ('all' | 'kitchen' | 'bar')
  const filteredTickets = tickets.filter((item) => {
    if (stationFilter === 'all') return true;
    return (item.prep_station || 'kitchen') === stationFilter;
  });

  // Group filtered items by order_id
  const groupedOrders = filteredTickets.reduce((acc, item) => {
    if (!acc[item.order_id]) {
      acc[item.order_id] = {
        order_id: item.order_id,
        daily_number: item.daily_number,
        order_type: item.order_type,
        table_number: item.table_number,
        waiter_name: item.waiter_name,
        sent_at: item.sent_at,
        items: [],
      };
    }
    acc[item.order_id].items.push(item);
    return acc;
  }, {});

  // Format elapsed time & determine color tier:
  // 0–13 min: Green | 14–29 min: Amber | 30+ min: Pulsing Red
  const getTimerState = (sentAt) => {
    const diffSec = Math.max(0, Math.floor((nowMs - new Date(sentAt).getTime()) / 1000));
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    const label = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (mins >= 30) {
      return {
        label,
        color: '#fca5a5',
        bg: 'rgba(220, 38, 38, 0.3)',
        border: '#ef4444',
        isOverdue: true,
      };
    }
    if (mins >= 15) {
      return {
        label,
        color: '#fcd34d',
        bg: 'rgba(245, 158, 11, 0.22)',
        border: '#f59e0b',
        isOverdue: false,
      };
    }
    return {
      label,
      color: '#6ee7b7',
      bg: 'rgba(16, 185, 129, 0.18)',
      border: '#10b981',
      isOverdue: false,
    };
  };

  const kitchenCount = tickets.filter((t) => (t.prep_station || 'kitchen') === 'kitchen').length;
  const barCount = tickets.filter((t) => t.prep_station === 'bar').length;

  return (
    <div style={{ minHeight: '100vh', background: t.bg, color: t.textMain, padding: '24px' }}>
      {/* Keyframes for 30+ min pulsing alert */}
      <style>{`
        @keyframes pulseRedBorder {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.65); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>

      {/* HEADER */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        borderBottom: `1px solid ${t.border}`,
        paddingBottom: '16px',
      }}>
        <div>
          <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: '700', letterSpacing: '1px' }}>
            KITCHEN DISPLAY SYSTEM
          </span>
          <h1 style={{ fontSize: '24px', marginTop: '4px', color: t.textMain }}>
            Active Order Tickets ({Object.keys(groupedOrders).length})
          </h1>
        </div>

        {/* STATION FILTER + CONTROLS */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          {/* Station Filter Pills */}
          <div style={{
            display: 'flex',
            background: t.cardBg,
            padding: '4px',
            borderRadius: '10px',
            border: `1px solid ${t.border}`,
          }}>
            {[
              { id: 'all', label: `All (${tickets.length})` },
              { id: 'kitchen', label: `🍳 Kitchen (${kitchenCount})` },
              { id: 'bar', label: `🍹 Bar (${barCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStationFilter(tab.id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '7px',
                  border: 'none',
                  background: stationFilter === tab.id ? '#0284c7' : 'transparent',
                  color: stationFilter === tab.id ? '#fff' : t.textMuted,
                  fontWeight: '700',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Recall Drawer Toggle */}
          <button
            onClick={() => setShowRecallDrawer((prev) => !prev)}
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              border: `1px solid ${t.border}`,
              background: showRecallDrawer ? t.border : t.cardBg,
              color: t.textMain,
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ↩ Recall ({recentlyCompleted.length})
          </button>

          {/* Audio Chime Toggle */}
          <button
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playNewOrderChime();
            }}
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              border: `1px solid ${soundEnabled ? '#38bdf8' : t.border}`,
              background: soundEnabled ? 'rgba(56, 189, 248, 0.15)' : t.cardBg,
              color: soundEnabled ? '#38bdf8' : t.textMuted,
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {soundEnabled ? '🔊 Sound ON' : '🔇 Muted'}
          </button>

          {/* THEME TOGGLE BUTTON */}
          <button
            onClick={toggleTheme}
            style={{
              padding: '8px 12px',
              borderRadius: '10px',
              border: `1px solid ${t.border}`,
              background: t.cardBg,
              color: t.textMain,
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>

          <span style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10b981',
            color: '#34d399',
            padding: '7px 14px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: '700',
          }}>
            ● LIVE SYNC
          </span>
        </div>
      </div>

      {/* RECALL RECENTLY BUMPED ITEMS DRAWER */}
      {showRecallDrawer && (
        <div style={{
          marginTop: '16px',
          background: t.cardBg,
          border: `1px solid ${t.border}`,
          borderRadius: '12px',
          padding: '14px 18px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: '800', color: '#38bdf8' }}>
              ↩ RECENTLY COMPLETED ITEMS (Tap to bring back to screen)
            </span>
            <button
              onClick={() => setShowRecallDrawer(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: t.textMuted,
                fontWeight: '700',
                cursor: 'pointer',
              }}
            >
              ✕ Close
            </button>
          </div>

          {recentlyCompleted.length === 0 ? (
            <div style={{ fontSize: '13px', color: t.textMuted }}>
              No recently bumped items in this session.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {recentlyCompleted.map((item) => (
                <button
                  key={`${item.item_id}-${item.completedAt}`}
                  onClick={() => handleRecallItem(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${t.border}`,
                    background: t.subCardBg,
                    color: t.textMain,
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: '#38bdf8', fontWeight: '800' }}>#{item.daily_number}</span>
                  <span>{item.quantity}x {item.item_name}</span>
                  <span style={{ fontSize: '11px', color: t.textMuted }}>({item.completedAt})</span>
                  <span style={{ color: '#fbbf24', fontWeight: '800' }}>↩ Undo</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TICKETS GRID */}
      {Object.keys(groupedOrders).length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '140px', fontSize: '20px', color: t.textMuted }}>
          No active orders{stationFilter !== 'all' ? ` for ${stationFilter.toUpperCase()}` : ''}. Waiting for new tickets...
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '20px',
          marginTop: '24px',
        }}>
          {Object.values(groupedOrders).map((order) => {
            const isTakeaway = order.order_type === 'takeaway';
            const isFullyCancelled = order.items.every((i) => i.prep_status === 'cancelled');
            const activeItemsCount = order.items.filter((i) => i.prep_status !== 'cancelled').length;

            // Earliest item sent_at drives the ticket timer
            const earliestSentAt = order.items.reduce(
              (min, i) => (new Date(i.sent_at) < new Date(min) ? i.sent_at : min),
              order.sent_at
            );
            const timer = getTimerState(earliestSentAt);

            const accentColor = isFullyCancelled
              ? '#ef4444'
              : timer.isOverdue
              ? '#ef4444'
              : isTakeaway
              ? '#38bdf8'
              : '#f59e0b';

            return (
              <div
                key={order.order_id}
                style={{
                  background: isFullyCancelled ? (theme === 'dark' ? '#450a0a' : '#fee2e2') : t.cardBg,
                  border: isFullyCancelled
                    ? '2px solid #ef4444'
                    : timer.isOverdue
                    ? '2px solid #ef4444'
                    : `1px solid ${t.border}`,
                  borderRadius: '14px',
                  padding: '18px',
                  borderTop: `6px solid ${accentColor}`,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                  animation: !isFullyCancelled && timer.isOverdue ? 'pulseRedBorder 1.8s infinite' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  {/* CANCELLED BANNER */}
                  {isFullyCancelled && (
                    <div style={{
                      background: '#dc2626',
                      color: '#fff',
                      textAlign: 'center',
                      fontWeight: '800',
                      fontSize: '13px',
                      padding: '6px',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      letterSpacing: '1px',
                    }}>
                      ✖ ORDER CANCELLED — STOP PREP
                    </div>
                  )}

                  {/* TICKET HEADER */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    borderBottom: `1px solid ${isFullyCancelled ? '#7f1d1d' : t.border}`,
                    paddingBottom: '12px',
                    marginBottom: '12px',
                  }}>
                    <div>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '800',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        background: isFullyCancelled
                          ? 'rgba(239, 68, 68, 0.25)'
                          : isTakeaway
                          ? 'rgba(56, 189, 248, 0.2)'
                          : 'rgba(245, 158, 11, 0.2)',
                        color: isFullyCancelled ? '#fca5a5' : isTakeaway ? '#38bdf8' : '#f59e0b',
                        textTransform: 'uppercase',
                      }}>
                        {isTakeaway ? '🛍️ Takeaway' : `🍽️ ${order.table_number}`}
                      </span>
                      <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: isFullyCancelled && theme === 'light' ? '#991b1b' : t.textMain }}>
                        Order #{order.daily_number}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      {/* LIVE ELAPSED PREP TIMER */}
                      {!isFullyCancelled && (
                        <div style={{
                          display: 'inline-block',
                          padding: '4px 10px',
                          borderRadius: '8px',
                          background: timer.bg,
                          border: `1px solid ${timer.border}`,
                          color: timer.color,
                          fontSize: '15px',
                          fontWeight: '800',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          ⏱ {timer.label}
                        </div>
                      )}
                      <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '6px' }}>
                        Sent {new Date(earliestSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {order.waiter_name && (
                        <div style={{ fontSize: '12px', color: isFullyCancelled ? '#fca5a5' : t.textMuted, marginTop: '2px' }}>
                          By: {order.waiter_name}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ORDER ITEMS */}
                  {order.items.map((item) => {
                    const isItemCancelled = item.prep_status === 'cancelled';
                    return (
                      <div
                        key={item.item_id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px',
                          marginBottom: '6px',
                          borderRadius: '8px',
                          background: isItemCancelled ? 'rgba(220, 38, 38, 0.25)' : t.itemBg,
                        }}
                      >
                        <div style={{ paddingRight: '10px' }}>
                          <div style={{
                            fontSize: '17px',
                            fontWeight: '700',
                            textDecoration: isItemCancelled ? 'line-through' : 'none',
                            color: isItemCancelled ? '#fca5a5' : t.textMain,
                          }}>
                            {item.quantity}x {item.item_name}
                          </div>
                          {stationFilter === 'all' && item.prep_station && (
                            <span style={{
                              display: 'inline-block',
                              marginTop: '3px',
                              fontSize: '10px',
                              fontWeight: '800',
                              textTransform: 'uppercase',
                              color: item.prep_station === 'bar' ? '#38bdf8' : t.textMuted,
                            }}>
                              {item.prep_station}
                            </span>
                          )}
                          {item.notes && (
                            <div style={{ color: '#f87171', fontSize: '13px', fontWeight: '600', marginTop: '4px' }}>
                              ⚠ {item.notes}
                            </div>
                          )}
                        </div>

                        {!isFullyCancelled && (
                          isItemCancelled ? (
                            <button
                              onClick={() => dismissCancelledItem(item.item_id)}
                              style={{
                                padding: '8px 14px',
                                background: '#dc2626',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: '800',
                                fontSize: '13px',
                                cursor: 'pointer',
                              }}
                            >
                              OK
                            </button>
                          ) : (
                            <button
                              onClick={() => markItemReady(item)}
                              style={{
                                padding: '8px 14px',
                                background: '#059669',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: '700',
                                fontSize: '13px',
                                cursor: 'pointer',
                              }}
                            >
                              Ready
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* BOTTOM TICKET ACTION */}
                {isFullyCancelled ? (
                  <button
                    onClick={() => dismissAllCancelledInOrder(order.items)}
                    style={{
                      width: '100%',
                      marginTop: '12px',
                      padding: '14px',
                      background: '#dc2626',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '800',
                      fontSize: '16px',
                      cursor: 'pointer',
                    }}
                  >
                    OK — Dismiss Cancelled Order
                  </button>
                ) : (
                  activeItemsCount > 1 && (
                    <button
                      onClick={() => bumpAllReadyInOrder(order.items)}
                      style={{
                        width: '100%',
                        marginTop: '12px',
                        padding: '11px',
                        background: '#0284c7',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: '800',
                        fontSize: '14px',
                        cursor: 'pointer',
                      }}
                    >
                      ✓ Bump All Ready ({activeItemsCount} items)
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}