const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");

const PORT = process.env.PORT || 3000;
const ORDERS_FILE = path.join(__dirname, "orders.json");

/* ---------- Orders (saved to orders.json so they survive a restart) ---------- */

const orders = (() => {
  try {
    const saved = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
})();

function saveOrders() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error("Could not save orders:", err.message);
  }
}

// Short, readable IDs like SBA-7F3K9 (no confusing characters such as 0/O or 1/I)
const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newOrderId() {
  let id;
  do {
    id = "SBA-" + Array.from(randomBytes(5), b => ID_CHARS[b % ID_CHARS.length]).join("");
  } while (orders.some(o => o.orderId === id));
  return id;
}

/* ---------- Products ----------
   color    : liquid colour used to draw each bottle on the website
   tagline  : one-line description shown on the product card
   keyNotes : short note list shown in the details window            */

const perfumes = [
  { id: 1, name: "ROYAL OUD", price: 5500, category: "SIGNATURE COLLECTION", color: "#c98a2b",
    tagline: "Deep oud, amber and warm spices.",
    keyNotes: ["Oud", "Amber", "Spices"],
    description: "A bold, rich fragrance inspired by timeless elegance. Deep oud, amber and warm spices create a powerful and unforgettable scent.",
    size: "100ml" },
  { id: 2, name: "OCEAN MIST", price: 4200, category: "FRESH COLLECTION", color: "#1f72bd",
    tagline: "Fresh aquatic notes, citrus and sea breeze.",
    keyNotes: ["Aquatic", "Citrus", "Sea Breeze"],
    description: "A refreshing fragrance inspired by the ocean, with bright citrus and cool aquatic notes.",
    size: "100ml" },
  { id: 3, name: "GOLDEN HOUR", price: 4800, category: "LUXURY COLLECTION", color: "#e08a24",
    tagline: "Warm vanilla, amber and sandalwood.",
    keyNotes: ["Vanilla", "Amber", "Sandalwood"],
    description: "Warm vanilla and glowing amber meet smooth sandalwood for a rich, comforting scent.",
    size: "100ml" },
  { id: 4, name: "ROSE ELIXIR", price: 3900, category: "FLORAL COLLECTION", color: "#d65a77",
    tagline: "Rose petals, soft musk and jasmine.",
    keyNotes: ["Rose", "Musk", "Jasmine"],
    description: "A graceful floral fragrance combining rose and jasmine with a soft musk finish.",
    size: "100ml" },
  { id: 5, name: "MIDNIGHT", price: 5000, category: "INTENSE COLLECTION", color: "#262421",
    tagline: "Dark woods, leather and smoky notes.",
    keyNotes: ["Dark Woods", "Leather", "Smoke"],
    description: "Dark woods and smooth leather create a bold fragrance for evenings and special occasions.",
    size: "100ml" },
  { id: 6, name: "PURE BLISS", price: 3500, category: "FRESH COLLECTION", color: "#d5dade",
    tagline: "Clean musk, fresh linen and soft florals.",
    keyNotes: ["Musk", "Linen", "Florals"],
    description: "Clean, light and effortless, with soft florals and a fresh musk finish.",
    size: "100ml" },
  { id: 7, name: "FOREST EDGE", price: 4300, category: "NATURE COLLECTION", color: "#1f8a42",
    tagline: "Green leaves, cedarwood and bergamot.",
    keyNotes: ["Green Leaves", "Cedarwood", "Bergamot"],
    description: "Fresh green notes and cedarwood bring the calm, crisp feeling of a forest.",
    size: "100ml" },
  { id: 8, name: "VELVET DREAM", price: 4600, category: "ELEGANCE COLLECTION", color: "#7b3fb3",
    tagline: "Sweet berries, vanilla and soft florals.",
    keyNotes: ["Berries", "Vanilla", "Florals"],
    description: "A smooth, softly sweet fragrance with berries, vanilla and delicate florals.",
    size: "100ml" },
  { id: 9, name: "SILVER STORM", price: 5200, category: "PREMIUM COLLECTION", color: "#c4c9cf",
    tagline: "Spicy pepper, fresh citrus and musk.",
    keyNotes: ["Pepper", "Citrus", "Musk"],
    description: "Crisp citrus and pepper open into a modern, confident musk fragrance.",
    size: "100ml" },
  { id: 10, name: "ROUGE ROYALE", price: 5800, category: "EXCLUSIVE COLLECTION", color: "#c2182b",
    tagline: "Saffron, rose, amber and rich woods.",
    keyNotes: ["Saffron", "Rose", "Amber", "Woods"],
    description: "A luxurious blend of saffron, rose and amber grounded by rich woods.",
    size: "100ml" }
];

/* ---------- Helpers ---------- */

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 100000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

// Customer details are private. Allow the admin list only from this computer,
// or from anywhere when the correct ADMIN_KEY header is sent.
function isAdmin(req) {
  const key = process.env.ADMIN_KEY;
  if (key) return req.headers["x-admin-key"] === key;

  const addr = req.socket.remoteAddress;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

const PHONE_OK = /^[+0-9\s\-()]{10,20}$/;

/* ---------- Server ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const route = url.pathname;

  if (req.method === "GET" && route === "/") {
    const file = path.join(__dirname, "index.html");

    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end("index.html not found");
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === "GET" && route === "/api/health") {
    return json(res, 200, {
      status: "running",
      brand: "SCENTS BY AHMED",
      products: perfumes.length,
      orders: orders.length
    });
  }

  if (req.method === "GET" && route === "/api/products") {
    return json(res, 200, {
      brand: "SCENTS BY AHMED",
      currency: "PKR",
      products: perfumes
    });
  }

  if (req.method === "GET" && route.startsWith("/api/products/")) {
    const product = perfumes.find(p => p.id === Number(route.split("/").pop()));

    return product
      ? json(res, 200, { product })
      : json(res, 404, { error: "Perfume not found" });
  }

  if (req.method === "POST" && route === "/api/orders") {
    try {
      const body = await readBody(req);
      const c = body.customer || {};

      const name = String(c.name || "").trim();
      const phone = String(c.phone || "").trim();
      const address = String(c.address || "").trim();

      if (!name || !phone || !address) {
        return json(res, 400, { error: "Please complete all delivery details." });
      }

      if (name.length > 100 || address.length > 500) {
        return json(res, 400, { error: "Name or address is too long." });
      }

      if (!PHONE_OK.test(phone) || phone.replace(/\D/g, "").length < 10) {
        return json(res, 400, { error: "Please enter a valid phone number." });
      }

      if (!Array.isArray(body.items) || !body.items.length) {
        return json(res, 400, { error: "Your cart is empty." });
      }

      // Prices always come from the server, never from the browser.
      const items = [];

      for (const entry of body.items) {
        const p = perfumes.find(x => x.id === Number(entry.id));
        const quantity = Number(entry.quantity);

        if (!p || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
          return json(res, 400, { error: "Invalid product or quantity." });
        }

        items.push({
          id: p.id,
          name: p.name,
          price: p.price,
          quantity,
          subtotal: p.price * quantity
        });
      }

      const total = items.reduce((sum, item) => sum + item.subtotal, 0);

      const order = {
        orderId: newOrderId(),
        customer: { name, phone, address },
        items,
        total,
        currency: "PKR",
        payment: "Cash on Delivery",
        status: "Pending",
        createdAt: new Date().toISOString()
      };

      orders.push(order);
      saveOrders();

      console.log("\nNEW ORDER\n" + JSON.stringify(order, null, 2) + "\n");

      return json(res, 201, { success: true, message: "Order received", order });

    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "GET" && route === "/api/admin/orders") {
    if (!isAdmin(req)) {
      return json(res, 403, { error: "Not allowed" });
    }

    return json(res, 200, { count: orders.length, orders });
  }

  return json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log("SCENTS BY AHMED");
  console.log(`Website: http://localhost:${PORT}`);
  console.log(`Backend running | ${perfumes.length} perfumes | ${orders.length} saved orders | Currency: PKR`);
});