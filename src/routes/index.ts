import type { Express } from 'express';
import { productsRouter } from './products.js';
import { categoriesRouter } from './categories.js';
import { searchRouter } from './search.js';
import { ingredientsRouter } from './ingredients.js';

export function registerRoutes(app: Express): void {
  app.use('/api/products', productsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/ingredients', ingredientsRouter);
  app.use('/api/search', searchRouter);
}
