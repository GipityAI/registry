/**
 * The assistant: who it is, what it knows, what it can do. This is the file to
 * edit. Every setting is explained in src/packages/chatbot/README.md.
 *
 * Out of the box it answers questions about a demo shop (customers, products,
 * orders) by writing SQL against your database through the query_data tool.
 * Point it at your own data by changing the tables in migrations/, the grant
 * on query-data in gipity.yaml, and the schema notes in `knowledge` below.
 */
import { functionStore } from '@gipity/chatbot';

export default {
  persona: {
    name: 'Gip',
    instructions: `You are Gip, a sharp, friendly analyst for an outdoor-gear shop.
You answer questions about the shop's customers, products and orders by querying its database with the query_data tool.
Work like a good analyst: query before you answer, show the key numbers in a small table, then give the one or two takeaways that matter.
Round money to whole dollars and say which time period you used.
You can also read files and photos people attach, save notes when asked (save_note) and find them again (list_notes), and create images (generate_image).`,
    tone: 'Clear, warm, concise. Plain language, no jargon.',
    greeting: "Hi, I'm **Gip**. Ask me anything about the shop's sales, customers or products, or attach a file to analyse.",
    starters: [
      'How did sales do last month?',
      'Who are our top 5 customers?',
      'Which products are trending up?',
      'Compare web vs mobile orders',
    ],
  },

  // What the model knows before it calls anything: the schema it queries.
  knowledge: {
    sources: [
      {
        type: 'text',
        content: `Database (PostgreSQL). Query it with query_data; one SELECT at a time.

customers(short_guid, name, city, country, segment, joined_on)
  segment is 'consumer' or 'business'; country is a 2-letter code.
products(short_guid, name, category, price)
  category is Footwear, Apparel, Gear or Accessories.
orders(short_guid, customer_guid -> customers.short_guid, ordered_at timestamptz, status, channel)
  status: delivered, shipped, processing, cancelled, refunded. channel: web, mobile, marketplace.
  Revenue counts only delivered, shipped and processing orders.
order_items(order_guid -> orders.short_guid, line, product_guid -> products.short_guid, quantity, unit_price)
  An order's value is sum(quantity * unit_price) of its items.

Today is ${new Date().toISOString().slice(0, 10)}. Use date_trunc and intervals relative to NOW() for periods.`,
      },
    ],
  },

  // Tools are this app's own functions (functions/*.js), called as the
  // signed-in user. confirm: true asks the user before it runs.
  tools: [
    {
      name: 'query_data',
      description: 'Run one read-only SQL SELECT over the shop tables (customers, products, orders, order_items). Returns { rowCount, columns, rows } (at most 200 rows) or { error } to fix and retry.',
      function: 'query-data',
      parameters: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'A single PostgreSQL SELECT (or WITH ... SELECT) statement' } },
        required: ['sql'],
      },
    },
    {
      name: 'save_note',
      description: "Save a note for the user (a finding, a summary, a to-do). Only when the user asks you to save or remember something.",
      function: 'save-note',
      confirm: true,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short title' },
          body: { type: 'string', description: 'The note, in Markdown' },
        },
        required: ['title', 'body'],
      },
    },
    {
      name: 'list_notes',
      description: "The user's saved notes, newest first.",
      function: 'list-notes',
    },
  ],

  features: {
    vision: { enabled: true },      // attach photos and screenshots
    files: { enabled: true },       // attach CSV, logs, JSON, code
    voice: { enabled: true },       // mic button and read aloud
    imageGen: { enabled: true },    // the generate_image tool
  },

  // Saved per user in this app's database (functions/chats.js).
  storage: { persist: functionStore('chats') },

  model: {
    route: 'medium',
    choices: [
      { route: 'fast', label: 'Fast' },
      { route: 'medium', label: 'Balanced' },
      { route: 'large', label: 'Smartest' },
    ],
    maxTokens: 4096,
    maxToolSteps: 8,
  },

  ui: {
    placement: 'inline',            // fills #chat, with the conversation sidebar
    placeholder: 'Ask about sales, customers, products...',
    showUsage: false,               // true shows the credits each answer cost
  },
};
