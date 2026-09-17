import { prisma, memoryStore } from '../db/client';

export class ServerSavedRepository {
  async toggleSaved(userId: string = 'default-user', experienceId: string, isSaved: boolean) {
    try {
      if (process.env.DATABASE_URL) {
        if (isSaved) {
          return await prisma.savedExperience.upsert({
            where: {
              userId_experienceId: { userId, experienceId },
            },
            create: { userId, experienceId },
            update: { savedAt: new Date() },
          });
        } else {
          return await prisma.savedExperience.deleteMany({
            where: { userId, experienceId },
          });
        }
      }
    } catch {}

    if (isSaved) {
      memoryStore.saved.add(experienceId);
    } else {
      memoryStore.saved.delete(experienceId);
    }
    return { success: true };
  }

  async getSaved(userId: string = 'default-user') {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.savedExperience.findMany({
          where: { userId },
          include: { experience: true },
          orderBy: { savedAt: 'desc' },
        });
      }
    } catch {}

    return Array.from(memoryStore.saved).map((id) => ({
      userId,
      experienceId: id,
      savedAt: new Date(),
      experience: memoryStore.experiences.get(id),
    }));
  }
}

export const serverSavedRepo = new ServerSavedRepository();
