# 🍽️ Posify

**Posify** is a modern, real-time Point of Sale (POS) and restaurant management system built to streamline front-of-house ordering, kitchen/bar workflows, and administrative control. Powered by WebSockets for instant updates, Posify keeps the entire staff synchronized across tables, takeaways, and back-office management.

---

## ✨ Key Features

* **🍽️ Dual Operating Modes:** Seamlessly switch between Restaurant (Floor Plan & Table Management) and Takeaway order queues.
* **⚡ Real-Time WebSockets:** Instant synchronization of orders, ticket statuses, and menu changes across terminals without needing to refresh.
* **🪑 Table Management & Transfer:** Open, move, merge, or split bills (evenly or by individual items) on the fly.
* **🎁 Staff & Admin Controls:** Role-based access control (Admin, Cashier, Waiter) with 4-digit PIN authentication, customizable menus, category reordering, and item availability toggles ("Sold Out").
* **📄 Auditing & Daily Reports:** Generate daily sales reports (`.YYYY-MM-DD.txt`) tracking cash, card, comped ("On the House") items, and cancellations.
* **🎨 Universal Theme Synchronization:** Seamlessly syncs light and dark mode preferences across all cashier, admin, and display monitors via persistent storage.

---

## 🛠️ Tech Stack

* **Frontend:** React, React Router, Vite, Axios
* **Backend:** Node.js, Express
* **Real-Time Communication:** Socket.io
* **Database:** PostgreSQL (managed via pgAdmin)

---

## 🚀 Getting Started

Follow these instructions to get a local copy of Posify running on your machine.

### Prerequisites
* Node.js installed on your machine
* PostgreSQL installed and running locally

### 1. Clone the Repository
```bash
git clone [https://github.com/your-username/posify.git](https://github.com/your-username/posify.git)
cd posify
