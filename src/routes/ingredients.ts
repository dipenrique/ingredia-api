import { Router } from 'express';
import { getDb } from '../db/client.js';
import { buildCacheKey, cacheGet, cacheSet } from '../cache/index.js';
import { config } from '../config.js';

export const ingredientsRouter = Router();

const MAX_PAGE_SIZE = 48;
const DEFAULT_PAGE_SIZE = 24;

// Projection for returning ingredients — strip internal _id entirely.
// name_normalized is the public identifier for an ingredient.
const INGREDIENT_PROJECTION = { _id: 0, name: 1, name_normalized: 1 };

// Projection for products returned via an ingredient lookup.
const PRODUCT_PROJECTION = {
  _id: 0, id: 1, slug: 1, name: 1, brand: 1,
  price: 1, mrp: 1, discount: 1, rating: 1,
  reviewCount: 1, image: 1, categories: 1,
};

// ---------------------------------------------------------------------------
// GET /api/ingredients
// Query params: q (optional search term), page, pageSize
// Returns paginated ingredients from the ingredients collection.
// ---------------------------------------------------------------------------
ingredientsRouter.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    const cacheKey = buildCacheKey('ingredients', { q, page, pageSize });
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const db = await getDb();
    const col = db.collection(config.collections.ingredients);

    // Filter by name_normalized (case-insensitive prefix/substring match).
    const filter = q
      ? { name_normalized: { $regex: q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : {};

    const [items, total] = await Promise.all([
      col.aggregate([
        { $match: filter },
        { $sort: { name: 1 } },
        { $skip: skip },
        { $limit: pageSize },
        { $project: INGREDIENT_PROJECTION },
      ]).toArray(),
      col.countDocuments(filter),
    ]);

    const body = { items, total, page, pageSize, hasMore: skip + items.length < total };
    cacheSet(cacheKey, body, 'categories'); // reuse the 30-min TTL bucket
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=300');
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/ingredients/:nameNormalized/products
// Returns paginated products that contain the given ingredient.
// :nameNormalized is the ingredient's name_normalized value (e.g. "vitamin c").
// ---------------------------------------------------------------------------
ingredientsRouter.get('/:nameNormalized/products', async (req, res, next) => {
  try {
    const nameNormalized = decodeURIComponent(req.params.nameNormalized).toLowerCase().trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      price_asc:     { price: 1 },
      price_desc:    { price: -1 },
      rating_desc:   { rating: -1 },
      discount_desc: { discount: -1 },
    };
    const mongoSort = sortMap[String(req.query.sort)] ?? { rating: -1 };

    const cacheKey = buildCacheKey(`ingredient:${nameNormalized}:products`, {
      page, pageSize, sort: req.query.sort ?? '',
    });
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const db = await getDb();

    // Step 1: resolve the ingredient document to get its ObjectId.
    const ingredient = await db
      .collection(config.collections.ingredients)
      .findOne({ name_normalized: nameNormalized });

    if (!ingredient) {
      res.status(404).json({ error: `Ingredient "${nameNormalized}" not found` });
      return;
    }

    // Step 2: find products whose ingredient_list_names array contains this ingredient's name.
    const productCol = db.collection(config.collections.products);
    const filter = { ingredient_list_names: ingredient.name as string };

    const [items, total] = await Promise.all([
      productCol
        .find(filter)
        .sort(mongoSort)
        .skip(skip)
        .limit(pageSize)
        .project(PRODUCT_PROJECTION)
        .toArray(),
      productCol.countDocuments(filter),
    ]);

    const body = {
      ingredient: {
        name: ingredient.name as string,
        name_normalized: ingredient.name_normalized as string,
      },
      items,
      total,
      page,
      pageSize,
      hasMore: skip + items.length < total,
    };

    cacheSet(cacheKey, body, 'productList');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=120');
    res.json(body);
  } catch (err) {
    next(err);
  }
});
