import { Router } from 'express';
import { getDb } from '../db/client.js';
import { buildCacheKey, cacheGet, cacheSet } from '../cache/index.js';
import { searchLimiter } from '../middleware/rate-limit.js';
import { config } from '../config.js';

export const searchRouter = Router();

// Stricter rate limit on search to prevent data harvesting.
searchRouter.use(searchLimiter);

const MAX_PAGE_SIZE = 24;
const DEFAULT_PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// GET /api/search
// Query params:
//   q          – search term (required, min 2 chars)
//   type       – "products" | "ingredients" | "all" (default: "all")
//   page, pageSize
//   category, brand  – narrow products results
// ---------------------------------------------------------------------------
searchRouter.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();

    if (q.length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters.' });
      return;
    }

    // Hard cap the query length to prevent regex DoS.
    const safeQ = q.slice(0, 100);

    const type = String(req.query.type ?? 'all');
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;
    const { category, brand } = req.query;

    const cacheKey = buildCacheKey('search', {
      q: safeQ, type, page, pageSize,
      category: category ?? '', brand: brand ?? '',
    });

    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const db = await getDb();
    const col = db.collection(config.collections.products);

    // Escape special regex characters from user input.
    const escapedQ = safeQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escapedQ, $options: 'i' };

    const baseFilter: Record<string, unknown> = {};
    if (category) baseFilter['categories.name'] = { $regex: String(category), $options: 'i' };
    if (brand) baseFilter.brand = { $regex: String(brand), $options: 'i' };

    const productProjection = {
      _id: 0, id: 1, slug: 1, name: 1, brand: 1,
      price: 1, mrp: 1, discount: 1, rating: 1,
      reviewCount: 1, image: 1, categories: 1,
    };

    let products: object[] = [];
    let productsTotal = 0;
    let ingredients: object[] = [];
    let ingredientsTotal = 0;
    let ingredientNames: object[] = [];
    let ingredientNamesTotal = 0;

    // --- Product search (by name or brand) ---
    if (type === 'products' || type === 'all') {
      const productFilter = {
        ...baseFilter,
        $or: [{ name: regex }, { brand: regex }],
      };
      const [items, total] = await Promise.all([
        col.find(productFilter).skip(skip).limit(pageSize).project(productProjection).toArray(),
        col.countDocuments(productFilter),
      ]);
      products = items;
      productsTotal = total;
    }

    // --- Ingredient search: match against the structured ingredient_list_names array ---
    // ingredient_list_names is an array of strings; MongoDB regex matches any element.
    if (type === 'ingredients' || type === 'all') {
      const ingredientFilter = {
        ...baseFilter,
        ingredient_list_names: regex,
      };
      const ingredientProjection = {
        _id: 0, id: 1, slug: 1, name: 1, brand: 1,
        price: 1, mrp: 1, discount: 1, rating: 1,
        reviewCount: 1, image: 1, categories: 1,
        ingredient_list_names: 1,
      };
      const [items, total] = await Promise.all([
        col.find(ingredientFilter).skip(skip).limit(pageSize).project(ingredientProjection).toArray(),
        col.countDocuments(ingredientFilter),
      ]);
      ingredients = items;
      ingredientsTotal = total;
    }

    // --- Ingredient name search: match against the ingredients collection ---
    if (type === 'ingredient_names' || type === 'all') {
      const ingredientCol = db.collection(config.collections.ingredients);
      const nameFilter = {
        $or: [
          { name: { $regex: escapedQ, $options: 'i' } },
          { name_normalized: { $regex: escapedQ, $options: 'i' } },
        ],
      };
      const [items, total] = await Promise.all([
        ingredientCol
          .find(nameFilter)
          .sort({ name: 1 })
          .skip(skip)
          .limit(pageSize)
          .project({ _id: 0, name: 1, name_normalized: 1 })
          .toArray(),
        ingredientCol.countDocuments(nameFilter),
      ]);
      ingredientNames = items;
      ingredientNamesTotal = total;
    }

    const body = {
      query: safeQ,
      products: {
        items: products,
        total: productsTotal,
        page,
        pageSize,
        hasMore: skip + products.length < productsTotal,
      },
      ingredients: {
        items: ingredients,
        total: ingredientsTotal,
        page,
        pageSize,
        hasMore: skip + ingredients.length < ingredientsTotal,
      },
      ingredientNames: {
        items: ingredientNames,
        total: ingredientNamesTotal,
        page,
        pageSize,
        hasMore: skip + ingredientNames.length < ingredientNamesTotal,
      },
    };

    cacheSet(cacheKey, body, 'search');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(body);
  } catch (err) {
    next(err);
  }
});
