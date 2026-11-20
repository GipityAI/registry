/**
 * The assistant: who it is, what it knows, what it can do. This is the file to
 * edit. Every setting is explained in src/packages/chatbot/README.md.
 *
 * Out of the box it answers questions about a demo shop (customers, products,
 * orders) by writing SQL against your database through the query_data tool.
 * Point it at your own data by changing the tables in migrations/, the grant
 * on query-data in gipity.yaml, and the table list in query_data's
 * description below.
 */
import { functionStore } from '@gipity/chatbot';

export default {
  // Who the assistant is and how it works. Not what its tools do: each tool
  // describes itself below, and the kit tells the model about attachments.
  persona: {
    name: 'Gip',
    instructions: `A sharp, friendly analyst for an outdoor-gear shop: you answer questions about its customers, products and orders.
Work like a good analyst: look the numbers up before you answer, show the key ones in a small table, then give the one or two takeaways that matter.
Round money to whole dollars and say which time period you used. If a question is ambiguous (which period? which channel?), pick the sensible default, say what you picked, and offer the alternative.`,
    tone: 'Clear, warm, concise. Plain language, no jargon.',
    greeting: "Hi, I'm **Gip**. Ask me anything about the shop's sales, customers or products, or attach a file to analyse.",
    starters: [
      'How did sales do last month?',
      'Who are our top 5 customers?',
      'Which products are trending up?',
      'Compare web vs mobile orders',
    ],
  },

  // Reference text. load: 'always' documents go in every request (keep them
  // short: facts most answers need). load: 'lookup' documents stay out of the
  // prompt until the model reads one with the built-in read_knowledge tool,
  // so they can be long. The database schema is not here: it belongs to the
  // query_data tool, so it lives in that tool's description.
  knowledge: {
    sources: [
      {
        type: 'text',
        title: 'Metric definitions',
        content: `Revenue: the value of delivered, shipped and processing orders (cancelled and refunded orders do not count).
Average order value (AOV): revenue / number of counted orders.
Repeat customer: a customer with two or more counted orders.
Default period when none is given: the last full calendar month. "This year" means calendar year to date.`,
      },
      {
        type: 'text',
        title: 'Store policies',
        summary: 'returns, refunds, shipping and warranty rules',
        load: 'lookup',
        content: `Returns: 60 days from delivery, unused, with the order number. Footwear may be worn indoors only.
Refunds: to the original payment method within 5 business days of the return arriving. Shipping is refunded only for our mistakes.
Shipping: free over $75 in the US; otherwise $7.95. Orders placed by 2 pm ship the same business day. Marketplace orders ship from the marketplace's warehouse and follow its rules.
Warranty: 2 years on Gear and Footwear against defects in materials and workmanship; Apparel and Accessories 1 year. Wear and tear and misuse are not covered.`,
      },
    ],
  },

  // Tools are this app's own functions (functions/*.js), called as the
  // signed-in user. confirm: true asks the user before it runs. A tool's
  // description is what the model reads when deciding to call it: say what it
  // does, when to use it, and everything needed to call it well.
  tools: [
    {
      name: 'query_data',
      description: `Run one read-only PostgreSQL SELECT (or WITH ... SELECT) over the shop database. Use it for any question about customers, products, orders or sales; query before answering, never estimate.
Returns { rowCount, columns, rows } with at most 200 rows, so aggregate in SQL rather than fetching raw rows. On a mistake it returns { error }: fix the SQL and try again.

Tables:
customers(short_guid, name, city, country, segment, joined_on)
  segment: 'consumer' | 'business'. country: 2-letter code.
products(short_guid, name, category, price)
  category: 'Footwear' | 'Apparel' | 'Gear' | 'Accessories'.
orders(short_guid, customer_guid -> customers.short_guid, ordered_at timestamptz, status, channel)
  status: 'delivered' | 'shipped' | 'processing' | 'cancelled' | 'refunded'. channel: 'web' | 'mobile' | 'marketplace'.
order_items(order_guid -> orders.short_guid, line, product_guid -> products.short_guid, quantity, unit_price)

An order's value is SUM(quantity * unit_price) over its items. Revenue counts only status IN ('delivered', 'shipped', 'processing'). For periods use date_trunc and intervals relative to NOW().`,
      function: 'query-data',
      parameters: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'One PostgreSQL SELECT or WITH ... SELECT statement' } },
        required: ['sql'],
      },
    },
    {
      name: 'save_note',
      description: 'Save a note for the user: a finding, a summary or a to-do. Only when the user asks you to save, note or remember something. The user approves it first.',
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
      description: "The user's saved notes, newest first. Use it when they ask about their notes or what they saved earlier.",
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
