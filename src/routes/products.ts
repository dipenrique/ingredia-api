import { Router } from 'express';
import { getDb } from '../db/client.js';
import { buildCacheKey, cacheGet, cacheSet } from '../cache/index.js';
import { config } from '../config.js';

export const productsRouter = Router();

// Fields exposed to the client — never return _id, ingredient_list_ids, or
// internal timestamps.
const LIST_PROJECTION = {
  _id: 0,
  id: 1,
  slug: 1,
  name: 1,
  brand: 1,
  price: 1,
  mrp: 1,
  discount: 1,
  rating: 1,
  reviewCount: 1,
  image: 1,
  categories: 1,
};

const DETAIL_PROJECTION = {
  ...LIST_PROJECTION,
  images: 1,
  // Both representations of the ingredient list
  ingredient_list_names: 1,   // array of strings, preferred for display
  ingredients: 1,             // raw comma-separated string, kept for compatibility
  sku: 1,
  url: 1,
};

const MAX_PAGE_SIZE = 48;
const DEFAULT_PAGE_SIZE = 24;

// ---------------------------------------------------------------------------
// GET /api/products
// Query params: page, pageSize, category, brand, inStock, sort
// ---------------------------------------------------------------------------
productsRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    const { category, brand, inStock, sort } = req.query;

    const filter: Record<string, unknown> = {};
    if (category) filter['categories.name'] = { $regex: String(category), $options: 'i' };
    if (brand) filter.brand = { $regex: String(brand), $options: 'i' };
    if (inStock === 'true') filter.inStock = true;

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      price_asc:     { price: 1 },
      price_desc:    { price: -1 },
      rating_desc:   { rating: -1 },
      discount_desc: { discount: -1 },
      newest:        { scrapedAt: -1 },
    };
    const mongoSort = sortMap[String(sort)] ?? { rating: -1 };

    const cacheKey = buildCacheKey('products', { page, pageSize, category: category ?? '', brand: brand ?? '', inStock: inStock ?? '', sort: sort ?? '' });
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const db = await getDb();
    const col = db.collection(config.collections.products);

    const [items, total] = await Promise.all([
      col.find(filter).sort(mongoSort).skip(skip).limit(pageSize).project(LIST_PROJECTION).toArray(),
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

// ---------------------------------------------------------------------------
// GET /api/products/:idOrSlug
// Accepts the numeric Nykaa product id or the slug string.
// ---------------------------------------------------------------------------
productsRouter.get('/:idOrSlug', async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const cacheKey = `product:${idOrSlug}`;

    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const db = await getDb();
    const col = db.collection(config.collections.products);

    // Numeric strings are treated as the Nykaa product id, otherwise slug.
    const filter = /^\d+$/.test(idOrSlug)
      ? { id: idOrSlug }
      : { slug: idOrSlug };

    const product = await col.findOne(filter, { projection: DETAIL_PROJECTION });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    cacheSet(cacheKey, product, 'productDetail');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=300');
    res.json(product);
  } catch (err) {
    next(err);
  }
});
