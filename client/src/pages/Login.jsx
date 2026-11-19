import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../socket';

export default function Login({ onLogin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [storeName, setStoreName] = useState('Bistro POS');
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API_URL}/api/settings`).then((res) => {
      if (res.data?.store_name) setStoreName(res.data.store_name);
    });
  }, []);

  const handleDigit = async (digit) => {
    if (pin.length >= 4) return;
    setError('');
    const nextPin = pin + digit;
    setPin(nextPin);

    if (nextPin.length === 4) {
      try {
        const res = await axios.post(`${API_URL}/api/login`, { pin_code: nextPin });
        onLogin(res.data);
        navigate('/cashier');
      } catch (err) {
        setError('Invalid PIN. Try again.');
        setTimeout(() => setPin(''), 400);
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '20px',
    }}>
      <div style={{
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '20px',
        padding: '40px',
        width: '100%',
        maxWidth: '380px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '13px', fontWeight: '700', letterSpacing: '1.5px', color: '#38bdf8', textTransform: 'uppercase' }}>
          POS Terminal
        </div>
        <h1 style={{ fontSize: '26px', margin: '8px 0 6px 0', color: '#f8fafc' }}>{storeName}</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '28px' }}>
          Enter your 4-digit staff PIN
        </p>

        {/* PIN DOTS */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '20px' }}>
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: idx < pin.length ? '#38bdf8' : '#334155',
                border: idx < pin.length ? '2px solid #7dd3fc' : '2px solid #475569',
                transition: 'all 0.15s ease',
              }}
            />
          ))}
        </div>

        {/* ERROR MESSAGE */}
        <div style={{ height: '22px', marginBottom: '12px', color: '#f87171', fontSize: '14px', fontWeight: '600' }}>
          {error}
        </div>

        {/* KEYPAD */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              onClick={() => handleDigit(digit)}
              style={{
                padding: '20px',
                fontSize: '22px',
                fontWeight: '700',
                borderRadius: '12px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#f8fafc',
                cursor: 'pointer',
              }}
            >
              {digit}
            </button>
          ))}
          <button
            onClick={handleClear}
            style={{
              padding: '20px',
              fontSize: '15px',
              fontWeight: '700',
              borderRadius: '12px',
              border: '1px solid #334155',
              background: '#334155',
              color: '#cbd5e1',
              cursor: 'pointer',
            }}
          >
            CLR
          </button>
          <button
            onClick={() => handleDigit('0')}
            style={{
              padding: '20px',
              fontSize: '22px',
              fontWeight: '700',
              borderRadius: '12px',
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#f8fafc',
              cursor: 'pointer',
            }}
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            style={{
              padding: '20px',
              fontSize: '18px',
              fontWeight: '700',
              borderRadius: '12px',
              border: '1px solid #334155',
              background: '#334155',
              color: '#cbd5e1',
              cursor: 'pointer',
            }}
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}