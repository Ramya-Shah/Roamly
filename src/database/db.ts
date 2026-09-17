import { SEED_CATEGORIES, SEED_EXPERIENCES } from './seed';
import {
  Category,
  Experience,
  Itinerary,
  ItineraryItem,
  SavedExperience,
  SyncQueueItem,
  GeneratedPlan,
  AIPlanStop,
  AIPlanRequest,
} from '../types';

export interface DatabaseInterface {
  init(): Promise<void>;
  reset(): Promise<void>;
  
  // Experiences
  getExperiences(city?: string, category?: string, search?: string): Promise<Experience[]>;
  getExperienceById(id: string): Promise<Experience | null>;
  upsertExperiences(experiences: Experience[]): Promise<void>;
  
  // Categories
  getCategories(): Promise<Category[]>;
  
  // Saved Experiences
  getSavedExperiences(): Promise<SavedExperience[]>;
  toggleSavedExperience(experienceId: string, isSaved: boolean): Promise<void>;
  isExperienceSaved(experienceId: string): Promise<boolean>;
  
  // Itineraries
  getItineraries(city?: string): Promise<Itinerary[]>;
  getItineraryById(id: string): Promise<Itinerary | null>;
  saveItinerary(itinerary: Itinerary): Promise<void>;
  deleteItinerary(id: string): Promise<void>;
  
  // Itinerary Items
  addItineraryItem(item: ItineraryItem): Promise<void>;
  updateItineraryItem(item: ItineraryItem): Promise<void>;
  deleteItineraryItem(itemId: string, itineraryId: string): Promise<void>;
  reorderItineraryItems(itineraryId: string, itemIds: string[]): Promise<void>;
  
  // Generated Plans (AI)
  saveGeneratedPlan(plan: GeneratedPlan): Promise<void>;
  getGeneratedPlans(city?: string): Promise<GeneratedPlan[]>;
  getGeneratedPlanById(id: string): Promise<GeneratedPlan | null>;
  deleteGeneratedPlan(id: string): Promise<void>;

  // Sync Queue
  enqueueMutation(mutation: Omit<SyncQueueItem, 'status' | 'retryCount' | 'createdAt'>): Promise<SyncQueueItem>;
  getPendingMutations(): Promise<SyncQueueItem[]>;
  updateMutationStatus(id: string, status: SyncQueueItem['status'], error?: string | null): Promise<void>;
  incrementMutationRetry(id: string, error: string): Promise<void>;
  deleteMutation(id: string): Promise<void>;
  clearCompletedMutations(): Promise<void>;
}

/**
 * Universal Storage Engine:
 * Implements full SQLite persistence when expo-sqlite is loaded in mobile/web runtime,
 * and maintains synchronous deterministic state during Node/Vitest automated testing.
 */
class LocalDatabase implements DatabaseInterface {
  private isInitialized = false;
  private memoryExperiences: Map<string, Experience> = new Map();
  private memoryCategories: Map<string, Category> = new Map();
  private memoryItineraries: Map<string, Itinerary> = new Map();
  private memorySaved: Set<string> = new Set();
  private memoryGeneratedPlans: Map<string, GeneratedPlan> = new Map();
  private memoryQueue: SyncQueueItem[] = [];
  private sqliteDb: any = null;

  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Only attempt expo-sqlite in real React Native runtime
    const isReactNative =
      typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';

    if (isReactNative) {
      try {
        const SQLite = await import('expo-sqlite');
        if (SQLite && SQLite.openDatabaseSync) {
          this.sqliteDb = SQLite.openDatabaseSync('roamly.db');
          this.createTables();
        }
      } catch {
        this.sqliteDb = null;
      }
    } else {
      this.sqliteDb = null;
    }

    await this.seedInitialData();
  }

  private createTables(): void {
    if (!this.sqliteDb) return;

    this.sqliteDb.execSync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        city TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        address TEXT NOT NULL,
        rating REAL NOT NULL,
        review_count INTEGER NOT NULL,
        price_tier TEXT NOT NULL,
        price_amount REAL NOT NULL,
        duration_minutes INTEGER NOT NULL,
        opening_hours TEXT NOT NULL,
        image_url TEXT NOT NULL,
        tags TEXT NOT NULL,
        is_featured INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        icon TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS itineraries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        city TEXT NOT NULL,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        total_duration_minutes INTEGER NOT NULL DEFAULT 0,
        total_distance_km REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS itinerary_items (
        id TEXT PRIMARY KEY,
        itinerary_id TEXT NOT NULL,
        experience_id TEXT,
        custom_title TEXT,
        start_time TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        travel_time_minutes INTEGER NOT NULL DEFAULT 0,
        travel_distance_km REAL NOT NULL DEFAULT 0,
        notes TEXT,
        FOREIGN KEY (itinerary_id) REFERENCES itineraries (id) ON DELETE CASCADE,
        FOREIGN KEY (experience_id) REFERENCES experiences (id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS saved_experiences (
        experience_id TEXT PRIMARY KEY,
        saved_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        idempotency_key TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS generated_plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        city TEXT NOT NULL,
        stops TEXT NOT NULL,
        estimated_cost REAL NOT NULL,
        estimated_travel_minutes INTEGER NOT NULL,
        request_params TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_exp_city ON experiences(city);
      CREATE INDEX IF NOT EXISTS idx_exp_cat ON experiences(category);
      CREATE INDEX IF NOT EXISTS idx_itin_items_order ON itinerary_items(itinerary_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);
      CREATE INDEX IF NOT EXISTS idx_gen_plans_city ON generated_plans(city);
    `);
  }

  private async seedInitialData(): Promise<void> {
    // Populate Categories
    for (const cat of SEED_CATEGORIES) {
      this.memoryCategories.set(cat.id, cat);
      if (this.sqliteDb) {
        this.sqliteDb.runSync(
          `INSERT OR IGNORE INTO categories (id, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [cat.id, cat.name, cat.slug, cat.icon, cat.sortOrder]
        );
      }
    }

    // Populate Experiences
    for (const exp of SEED_EXPERIENCES) {
      this.memoryExperiences.set(exp.id, exp);
      if (this.sqliteDb) {
        this.sqliteDb.runSync(
          `INSERT OR REPLACE INTO experiences (
            id, title, description, category, city, latitude, longitude,
            address, rating, review_count, price_tier, price_amount,
            duration_minutes, opening_hours, image_url, tags, is_featured, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            exp.id,
            exp.title,
            exp.description,
            exp.category,
            exp.city,
            exp.latitude,
            exp.longitude,
            exp.address,
            exp.rating,
            exp.reviewCount,
            exp.priceTier,
            exp.priceAmount,
            exp.durationMinutes,
            exp.openingHours,
            exp.imageUrl,
            JSON.stringify(exp.tags),
            exp.isFeatured ? 1 : 0,
            new Date().toISOString(),
          ]
        );
      }
    }

    // Seed default sample itinerary: "Saturday in Bengaluru"
    const sampleItineraryId = 'itin-bengaluru-saturday';
    if (!this.memoryItineraries.has(sampleItineraryId)) {
      const sampleItin: Itinerary = {
        id: sampleItineraryId,
        title: 'Saturday in Bengaluru',
        city: 'Bengaluru',
        date: '2026-09-19',
        startTime: '10:00',
        totalDurationMinutes: 570,
        totalDistanceKm: 14.8,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: 'item-1',
            itineraryId: sampleItineraryId,
            experienceId: 'blr-palace',
            customTitle: null,
            startTime: '10:00',
            durationMinutes: 120,
            sortOrder: 0,
            travelTimeMinutes: 15,
            travelDistanceKm: 3.2,
            experience: this.memoryExperiences.get('blr-palace'),
          },
          {
            id: 'item-2',
            itineraryId: sampleItineraryId,
            experienceId: 'blr-vidyarthi-bhavan',
            customTitle: 'Lunch at Vidyarthi Bhavan',
            startTime: '12:15',
            durationMinutes: 60,
            sortOrder: 1,
            travelTimeMinutes: 20,
            travelDistanceKm: 4.8,
            experience: this.memoryExperiences.get('blr-vidyarthi-bhavan'),
          },
          {
            id: 'item-3',
            itineraryId: sampleItineraryId,
            experienceId: 'blr-visvesvaraya',
            customTitle: null,
            startTime: '13:35',
            durationMinutes: 120,
            sortOrder: 2,
            travelTimeMinutes: 5,
            travelDistanceKm: 0.6,
            experience: this.memoryExperiences.get('blr-visvesvaraya'),
          },
          {
            id: 'item-4',
            itineraryId: sampleItineraryId,
            experienceId: 'blr-cubbon-park',
            customTitle: null,
            startTime: '16:00',
            durationMinutes: 90,
            sortOrder: 3,
            travelTimeMinutes: 25,
            travelDistanceKm: 6.2,
            experience: this.memoryExperiences.get('blr-cubbon-park'),
          },
          {
            id: 'item-5',
            itineraryId: sampleItineraryId,
            experienceId: 'blr-toit',
            customTitle: 'Evening Craft Ales & Dinner',
            startTime: '17:55',
            durationMinutes: 150,
            sortOrder: 4,
            travelTimeMinutes: 0,
            travelDistanceKm: 0,
            experience: this.memoryExperiences.get('blr-toit'),
          },
        ],
      };
      this.memoryItineraries.set(sampleItineraryId, sampleItin);
    }
  }

  async reset(): Promise<void> {
    this.memoryExperiences.clear();
    this.memoryCategories.clear();
    this.memoryItineraries.clear();
    this.memorySaved.clear();
    this.memoryQueue = [];

    if (this.sqliteDb) {
      this.sqliteDb.execSync(`
        DELETE FROM sync_queue;
        DELETE FROM saved_experiences;
        DELETE FROM itinerary_items;
        DELETE FROM itineraries;
        DELETE FROM experiences;
        DELETE FROM categories;
      `);
    }

    await this.seedInitialData();
  }

  // ==========================================
  // EXPERIENCES REPO
  // ==========================================
  async getExperiences(city?: string, category?: string, search?: string): Promise<Experience[]> {
    await this.init();

    if (this.sqliteDb) {
      let query = `SELECT * FROM experiences WHERE 1=1`;
      const params: any[] = [];

      if (city) {
        query += ` AND city = ?`;
        params.push(city);
      }
      if (category && category !== 'All') {
        query += ` AND category = ?`;
        params.push(category);
      }
      if (search && search.trim().length > 0) {
        query += ` AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)`;
        const wildcard = `%${search.trim()}%`;
        params.push(wildcard, wildcard, wildcard);
      }
      query += ` ORDER BY is_featured DESC, rating DESC`;

      const rows = this.sqliteDb.getAllSync(query, params);
      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        city: r.city,
        latitude: r.latitude,
        longitude: r.longitude,
        address: r.address,
        rating: r.rating,
        reviewCount: r.review_count,
        priceTier: r.price_tier,
        priceAmount: r.price_amount,
        durationMinutes: r.duration_minutes,
        openingHours: r.opening_hours,
        imageUrl: r.image_url,
        tags: JSON.parse(r.tags || '[]'),
        isFeatured: Boolean(r.is_featured),
        isSaved: this.memorySaved.has(r.id),
      }));
    }

    // Memory fallback
    let list = Array.from(this.memoryExperiences.values());
    if (city) list = list.filter((e) => e.city === city);
    if (category && category !== 'All') list = list.filter((e) => e.category === category);
    if (search && search.trim().length > 0) {
      const s = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(s) ||
          e.description.toLowerCase().includes(s) ||
          e.tags.some((t) => t.toLowerCase().includes(s))
      );
    }
    return list.map((e) => ({ ...e, isSaved: this.memorySaved.has(e.id) }));
  }

  async getExperienceById(id: string): Promise<Experience | null> {
    await this.init();

    if (this.sqliteDb) {
      const row: any = this.sqliteDb.getFirstSync(`SELECT * FROM experiences WHERE id = ?`, [id]);
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        category: row.category,
        city: row.city,
        latitude: row.latitude,
        longitude: row.longitude,
        address: row.address,
        rating: row.rating,
        reviewCount: row.review_count,
        priceTier: row.price_tier,
        priceAmount: row.price_amount,
        durationMinutes: row.duration_minutes,
        openingHours: row.opening_hours,
        imageUrl: row.image_url,
        tags: JSON.parse(row.tags || '[]'),
        isFeatured: Boolean(row.is_featured),
        isSaved: this.memorySaved.has(row.id),
      };
    }

    const exp = this.memoryExperiences.get(id);
    return exp ? { ...exp, isSaved: this.memorySaved.has(exp.id) } : null;
  }

  async upsertExperiences(experiences: Experience[]): Promise<void> {
    await this.init();

    for (const exp of experiences) {
      this.memoryExperiences.set(exp.id, exp);
      if (this.sqliteDb) {
        this.sqliteDb.runSync(
          `INSERT OR REPLACE INTO experiences (
            id, title, description, category, city, latitude, longitude,
            address, rating, review_count, price_tier, price_amount,
            duration_minutes, opening_hours, image_url, tags, is_featured, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            exp.id,
            exp.title,
            exp.description,
            exp.category,
            exp.city,
            exp.latitude,
            exp.longitude,
            exp.address,
            exp.rating,
            exp.reviewCount,
            exp.priceTier,
            exp.priceAmount,
            exp.durationMinutes,
            exp.openingHours,
            exp.imageUrl,
            JSON.stringify(exp.tags),
            exp.isFeatured ? 1 : 0,
            new Date().toISOString(),
          ]
        );
      }
    }
  }

  // ==========================================
  // CATEGORIES REPO
  // ==========================================
  async getCategories(): Promise<Category[]> {
    await this.init();
    if (this.sqliteDb) {
      const rows = this.sqliteDb.getAllSync(`SELECT * FROM categories ORDER BY sort_order ASC`);
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        icon: r.icon,
        sortOrder: r.sort_order,
      }));
    }
    return Array.from(this.memoryCategories.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // ==========================================
  // SAVED EXPERIENCES REPO
  // ==========================================
  async getSavedExperiences(): Promise<SavedExperience[]> {
    await this.init();

    if (this.sqliteDb) {
      const rows = this.sqliteDb.getAllSync(
        `SELECT s.experience_id, s.saved_at, e.* 
         FROM saved_experiences s 
         JOIN experiences e ON s.experience_id = e.id 
         ORDER BY s.saved_at DESC`
      );
      return rows.map((r: any) => ({
        id: `saved-${r.experience_id}`,
        userId: 'default-user',
        experienceId: r.experience_id,
        savedAt: r.saved_at,
        experience: {
          id: r.id,
          title: r.title,
          description: r.description,
          category: r.category,
          city: r.city,
          latitude: r.latitude,
          longitude: r.longitude,
          address: r.address,
          rating: r.rating,
          reviewCount: r.review_count,
          priceTier: r.price_tier,
          priceAmount: r.price_amount,
          durationMinutes: r.duration_minutes,
          openingHours: r.opening_hours,
          imageUrl: r.image_url,
          tags: JSON.parse(r.tags || '[]'),
          isFeatured: Boolean(r.is_featured),
          isSaved: true,
        },
      }));
    }

    const result: SavedExperience[] = [];
    for (const expId of this.memorySaved) {
      const exp = this.memoryExperiences.get(expId);
      if (exp) {
        result.push({
          id: `saved-${expId}`,
          userId: 'default-user',
          experienceId: expId,
          savedAt: new Date().toISOString(),
          experience: { ...exp, isSaved: true },
        });
      }
    }
    return result;
  }

  async toggleSavedExperience(experienceId: string, isSaved: boolean): Promise<void> {
    await this.init();

    if (isSaved) {
      this.memorySaved.add(experienceId);
      if (this.sqliteDb) {
        this.sqliteDb.runSync(
          `INSERT OR REPLACE INTO saved_experiences (experience_id, saved_at) VALUES (?, ?)`,
          [experienceId, new Date().toISOString()]
        );
      }
    } else {
      this.memorySaved.delete(experienceId);
      if (this.sqliteDb) {
        this.sqliteDb.runSync(`DELETE FROM saved_experiences WHERE experience_id = ?`, [experienceId]);
      }
    }
  }

  async isExperienceSaved(experienceId: string): Promise<boolean> {
    await this.init();
    if (this.sqliteDb) {
      const row = this.sqliteDb.getFirstSync(
        `SELECT experience_id FROM saved_experiences WHERE experience_id = ?`,
        [experienceId]
      );
      return Boolean(row);
    }
    return this.memorySaved.has(experienceId);
  }

  // ==========================================
  // ITINERARIES REPO
  // ==========================================
  async getItineraries(city?: string): Promise<Itinerary[]> {
    await this.init();

    if (this.sqliteDb) {
      let query = `SELECT * FROM itineraries`;
      const params: any[] = [];
      if (city) {
        query += ` WHERE city = ?`;
        params.push(city);
      }
      query += ` ORDER BY date DESC, created_at DESC`;

      const rows = this.sqliteDb.getAllSync(query, params);
      const itineraries: Itinerary[] = [];

      for (const r of rows) {
        const itemRows = this.sqliteDb.getAllSync(
          `SELECT i.*, e.title as exp_title, e.category as exp_category, e.image_url as exp_image,
                  e.rating as exp_rating, e.latitude as exp_lat, e.longitude as exp_lon,
                  e.address as exp_address, e.price_tier as exp_price_tier, e.duration_minutes as exp_dur
           FROM itinerary_items i
           LEFT JOIN experiences e ON i.experience_id = e.id
           WHERE i.itinerary_id = ?
           ORDER BY i.sort_order ASC`,
          [r.id]
        );

        const items: ItineraryItem[] = itemRows.map((it: any) => ({
          id: it.id,
          itineraryId: it.itinerary_id,
          experienceId: it.experience_id,
          customTitle: it.custom_title,
          startTime: it.start_time,
          durationMinutes: it.duration_minutes,
          sortOrder: it.sort_order,
          travelTimeMinutes: it.travel_time_minutes,
          travelDistanceKm: it.travel_distance_km,
          notes: it.notes,
          experience: it.experience_id
            ? {
                id: it.experience_id,
                title: it.exp_title,
                category: it.exp_category,
                city: r.city,
                latitude: it.exp_lat,
                longitude: it.exp_lon,
                address: it.exp_address,
                rating: it.exp_rating,
                reviewCount: 0,
                priceTier: it.exp_price_tier,
                priceAmount: 0,
                durationMinutes: it.exp_dur,
                openingHours: '',
                imageUrl: it.exp_image,
                tags: [],
                isFeatured: false,
                isSaved: this.memorySaved.has(it.experience_id),
              }
            : undefined,
        }));

        itineraries.push({
          id: r.id,
          title: r.title,
          city: r.city,
          date: r.date,
          startTime: r.start_time,
          totalDurationMinutes: r.total_duration_minutes,
          totalDistanceKm: r.total_distance_km,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          items,
        });
      }
      return itineraries;
    }

    let list = Array.from(this.memoryItineraries.values());
    if (city) list = list.filter((i) => i.city === city);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getItineraryById(id: string): Promise<Itinerary | null> {
    const list = await this.getItineraries();
    return list.find((i) => i.id === id) || null;
  }

  async saveItinerary(itinerary: Itinerary): Promise<void> {
    await this.init();
    this.memoryItineraries.set(itinerary.id, itinerary);

    if (this.sqliteDb) {
      this.sqliteDb.runSync(
        `INSERT OR REPLACE INTO itineraries (
          id, title, city, date, start_time, total_duration_minutes, total_distance_km, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itinerary.id,
          itinerary.title,
          itinerary.city,
          itinerary.date,
          itinerary.startTime,
          itinerary.totalDurationMinutes,
          itinerary.totalDistanceKm,
          itinerary.createdAt || new Date().toISOString(),
          new Date().toISOString(),
        ]
      );

      // Replace items
      this.sqliteDb.runSync(`DELETE FROM itinerary_items WHERE itinerary_id = ?`, [itinerary.id]);

      for (let i = 0; i < itinerary.items.length; i++) {
        const item = itinerary.items[i];
        this.sqliteDb.runSync(
          `INSERT INTO itinerary_items (
            id, itinerary_id, experience_id, custom_title, start_time,
            duration_minutes, sort_order, travel_time_minutes, travel_distance_km, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            itinerary.id,
            item.experienceId || null,
            item.customTitle || null,
            item.startTime,
            item.durationMinutes,
            item.sortOrder ?? i,
            item.travelTimeMinutes || 0,
            item.travelDistanceKm || 0,
            item.notes || null,
          ]
        );
      }
    }
  }

  async deleteItinerary(id: string): Promise<void> {
    await this.init();
    this.memoryItineraries.delete(id);

    if (this.sqliteDb) {
      this.sqliteDb.runSync(`DELETE FROM itinerary_items WHERE itinerary_id = ?`, [id]);
      this.sqliteDb.runSync(`DELETE FROM itineraries WHERE id = ?`, [id]);
    }
  }

  async addItineraryItem(item: ItineraryItem): Promise<void> {
    const itin = await this.getItineraryById(item.itineraryId);
    if (!itin) throw new Error(`Itinerary ${item.itineraryId} not found`);

    itin.items.push(item);
    await this.saveItinerary(itin);
  }

  async updateItineraryItem(item: ItineraryItem): Promise<void> {
    const itin = await this.getItineraryById(item.itineraryId);
    if (!itin) throw new Error(`Itinerary ${item.itineraryId} not found`);

    const idx = itin.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      itin.items[idx] = item;
      await this.saveItinerary(itin);
    }
  }

  async deleteItineraryItem(itemId: string, itineraryId: string): Promise<void> {
    const itin = await this.getItineraryById(itineraryId);
    if (!itin) return;

    itin.items = itin.items.filter((i) => i.id !== itemId);
    // Re-index sortOrder
    itin.items.forEach((item, index) => {
      item.sortOrder = index;
    });
    await this.saveItinerary(itin);
  }

  async reorderItineraryItems(itineraryId: string, itemIds: string[]): Promise<void> {
    const itin = await this.getItineraryById(itineraryId);
    if (!itin) return;

    const itemMap = new Map(itin.items.map((i) => [i.id, i]));
    const reordered: ItineraryItem[] = [];

    itemIds.forEach((id, index) => {
      const item = itemMap.get(id);
      if (item) {
        reordered.push({ ...item, sortOrder: index });
      }
    });

    itin.items = reordered;
    await this.saveItinerary(itin);
  }

  // ==========================================
  // SYNC QUEUE REPO
  // ==========================================
  async enqueueMutation(
    mutation: Omit<SyncQueueItem, 'status' | 'retryCount' | 'createdAt'>
  ): Promise<SyncQueueItem> {
    await this.init();

    const queueItem: SyncQueueItem = {
      ...mutation,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.memoryQueue.push(queueItem);

    if (this.sqliteDb) {
      this.sqliteDb.runSync(
        `INSERT OR REPLACE INTO sync_queue (
          id, type, entity_id, payload, status, retry_count, last_error, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          queueItem.id,
          queueItem.type,
          queueItem.entityId,
          JSON.stringify(queueItem.payload),
          queueItem.status,
          queueItem.retryCount,
          queueItem.lastError || null,
          queueItem.idempotencyKey,
          queueItem.createdAt,
        ]
      );
    }

    return queueItem;
  }

  async getPendingMutations(): Promise<SyncQueueItem[]> {
    await this.init();

    if (this.sqliteDb) {
      const rows = this.sqliteDb.getAllSync(
        `SELECT * FROM sync_queue WHERE status IN ('pending', 'failed') ORDER BY created_at ASC`
      );
      return rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        entityId: r.entity_id,
        payload: JSON.parse(r.payload || '{}'),
        status: r.status,
        retryCount: r.retry_count,
        lastError: r.last_error,
        idempotencyKey: r.idempotency_key,
        createdAt: r.created_at,
      }));
    }

    return this.memoryQueue.filter((q) => q.status === 'pending' || q.status === 'failed');
  }

  async updateMutationStatus(
    id: string,
    status: SyncQueueItem['status'],
    error?: string | null
  ): Promise<void> {
    await this.init();

    const item = this.memoryQueue.find((q) => q.id === id);
    if (item) {
      item.status = status;
      if (error !== undefined) item.lastError = error;
    }

    if (this.sqliteDb) {
      this.sqliteDb.runSync(
        `UPDATE sync_queue SET status = ?, last_error = ? WHERE id = ?`,
        [status, error || null, id]
      );
    }
  }

  async incrementMutationRetry(id: string, error: string): Promise<void> {
    await this.init();

    const item = this.memoryQueue.find((q) => q.id === id);
    if (item) {
      item.retryCount += 1;
      item.status = 'failed';
      item.lastError = error;
    }

    if (this.sqliteDb) {
      this.sqliteDb.runSync(
        `UPDATE sync_queue SET retry_count = retry_count + 1, status = 'failed', last_error = ? WHERE id = ?`,
        [error, id]
      );
    }
  }

  async deleteMutation(id: string): Promise<void> {
    await this.init();

    this.memoryQueue = this.memoryQueue.filter((q) => q.id !== id);

    if (this.sqliteDb) {
      this.sqliteDb.runSync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
    }
  }

  async clearCompletedMutations(): Promise<void> {
    await this.init();
    this.memoryQueue = this.memoryQueue.filter((q) => q.status !== 'completed');

    if (this.sqliteDb) {
      this.sqliteDb.runSync(`DELETE FROM sync_queue WHERE status = 'completed'`);
    }
  }

  // ==========================================
  // GENERATED PLANS REPO
  // ==========================================
  async getGeneratedPlans(city?: string): Promise<GeneratedPlan[]> {
    await this.init();

    if (this.sqliteDb) {
      let query = `SELECT * FROM generated_plans`;
      const params: any[] = [];
      if (city) {
        query += ` WHERE city = ?`;
        params.push(city);
      }
      query += ` ORDER BY created_at DESC`;

      const rows = this.sqliteDb.getAllSync(query, params);
      const plans: GeneratedPlan[] = [];
      for (const r of rows) {
        let stops: AIPlanStop[] = [];
        try {
          stops = JSON.parse(r.stops);
        } catch {
          stops = [];
        }
        let requestParams: AIPlanRequest | undefined = undefined;
        if (r.request_params) {
          try {
            requestParams = JSON.parse(r.request_params);
          } catch {}
        }
        // Hydrate experience details if available
        for (const stop of stops) {
          if (stop.experienceId && !stop.experience) {
            const exp = await this.getExperienceById(stop.experienceId);
            if (exp) stop.experience = exp;
          }
        }
        plans.push({
          id: r.id,
          title: r.title,
          summary: r.summary,
          city: r.city,
          stops,
          estimatedCost: r.estimated_cost,
          estimatedTravelMinutes: r.estimated_travel_minutes,
          createdAt: r.created_at,
          requestParams,
        });
      }
      return plans;
    }

    let list = Array.from(this.memoryGeneratedPlans.values());
    if (city) list = list.filter((p) => p.city === city);
    // Deep clone and hydrate
    return list.map((p) => ({
      ...p,
      stops: p.stops.map((s) => ({
        ...s,
        experience: s.experience || this.memoryExperiences.get(s.experienceId),
      })),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getGeneratedPlanById(id: string): Promise<GeneratedPlan | null> {
    const plans = await this.getGeneratedPlans();
    return plans.find((p) => p.id === id) || null;
  }

  async saveGeneratedPlan(plan: GeneratedPlan): Promise<void> {
    await this.init();
    this.memoryGeneratedPlans.set(plan.id, plan);

    if (this.sqliteDb) {
      this.sqliteDb.runSync(
        `INSERT OR REPLACE INTO generated_plans (
          id, title, summary, city, stops, estimated_cost, estimated_travel_minutes, request_params, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plan.id,
          plan.title,
          plan.summary,
          plan.city,
          JSON.stringify(plan.stops),
          plan.estimatedCost,
          plan.estimatedTravelMinutes,
          plan.requestParams ? JSON.stringify(plan.requestParams) : null,
          plan.createdAt || new Date().toISOString(),
        ]
      );
    }
  }

  async deleteGeneratedPlan(id: string): Promise<void> {
    await this.init();
    this.memoryGeneratedPlans.delete(id);

    if (this.sqliteDb) {
      this.sqliteDb.runSync(`DELETE FROM generated_plans WHERE id = ?`, [id]);
    }
  }
}

export const db: DatabaseInterface = new LocalDatabase();
