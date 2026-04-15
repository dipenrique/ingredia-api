import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DATABASE ?? 'beauty';

  if (!uri) {
    throw new Error('MONGO_URI environment variable is not set');
  }

  client = new MongoClient(uri, {
    // Connection pool sized for a Render starter instance.
    // Increase maxPoolSize when upgrading to a larger plan.
    maxPoolSize: 10,
    minPoolSize: 2,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });

  await client.connect();
  db = client.db(dbName);

  console.log(`[db] Connected to MongoDB database "${dbName}"`);
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
