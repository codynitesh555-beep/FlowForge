import { defineConfig } from 'prisma/config';

// Client generation only reads the schema. Keep this config independent of
// scratch and migration URLs so cloud builds need no database credentials.
export default defineConfig({
  schema: 'prisma/schema.prisma',
});
