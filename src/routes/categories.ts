import { Router } from 'express';
import { getDb } from '../db/client.js';
import { buildCacheKey, cacheGet, cacheSet } from '../cache/index.js';
import { config } from '../config.js';

export const categoriesRouter = Router();

const MAX_PAGE_SIZE = 48;
const DEFAULT_PAGE_SIZE = 24;

// ---------------------------------------------------------------------------
// GET /api/categories
// Returns distinct top-level category names derived from the products collection.
// ---------------------------------------------------------------------------
categoriesRouter.get('/', async (_req, res, next) => {
  try {
    const cacheKey = 'categories:all';
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const db = await getDb();

    // Aggregate distinct categories from the embedded categories array on products.
    const items = await db
      .collection('products')
      .aggregate([
        { $unwind: '$categories' },
        {
          $group: {
            _id: '$categories.id',
            name: { $first: '$categories.name' },
            productCount: { $sum: 1 },
          },
        },
        { $match: { name: { $exists: true, $ne: null } } },
        { $project: { _id: 0, id: '$_id', name: 1, productCount: 1 } },
        { $sort: { productCount: -1 } },
      ])
      .toArray();

    const body = { items, total: items.length };
    cacheSet(cacheKey, body, 'categories');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=300');
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/categories/:id/products
// Returns paginated products that belong to a given category id or name.
// ---------------------------------------------------------------------------
categoriesRouter.get('/:id/products', async (req, res, next) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      price_asc:     { price: 1 },
      price_desc:    { price: -1 },
      rating_desc:   { rating: -1 },
      discount_desc: { discount: -1 },
      reviews_desc:  { reviewCount: -1 },
    };

    // const mongoSort = { ...(sortMap[String(req.query.sort)] ?? { rating: -1 }), id: 1 as const };
    const mongoSort = { ...(sortMap[String(req.query.sort)] ?? { reviewCount: -1 }), id: 1 as const };

    const cacheKey = buildCacheKey(`category:${id}:products`, { page, pageSize, sort: req.query.sort ?? '' });
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const db = await getDb();
    const col = db.collection(config.collections.products);

    // Match on either categories.id or categories.name to support both id and slug lookups.
    const filter = {
      $or: [
        { 'categories.id': id },
        { 'categories.name': { $regex: `^${id}$`, $options: 'i' } },
      ],
    };

    const projection = {
      _id: 0, id: 1, slug: 1, name: 1, brand: 1,
      price: 1, mrp: 1, discount: 1, rating: 1,
      reviewCount: 1, image: 1, inStock: 1,
    };

    const [items, total] = await Promise.all([
      col.find(filter).sort(mongoSort).skip(skip).limit(pageSize).project(projection).toArray(),
      col.countDocuments(filter),
    ]);

    const body = { items, total, page, pageSize, hasMore: skip + items.length < total };
    cacheSet(cacheKey, body, 'productList');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=120');
    res.json(body);
  } catch (err) {
    next(err);
  }
});
