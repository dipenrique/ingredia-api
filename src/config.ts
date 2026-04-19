/**
 * Central config read from environment variables.
 * All collection names are configurable so the API can be pointed at different
 * MongoDB databases without code changes.
 */

export const config = {
  collections: {
    products:    process.env.MONGO_COLLECTION_PRODUCTS ?? '',
    ingredients: process.env.MONGO_COLLECTION_INGREDIENTS ?? '',
  },
} as const;
