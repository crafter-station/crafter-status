import { desc } from "drizzle-orm";
import type { Database } from "./client.ts";
import { auditLog } from "./schema.ts";

export type AuditEntry = {
	actorUserId?: string | null;
	actorLabel?: string | null;
	action: string;
	targetType?: string;
	targetId?: string;
	metadata?: Record<string, unknown>;
};

export async function recordAudit(db: Database, entry: AuditEntry): Promise<void> {
	await db.insert(auditLog).values({
		actorUserId: entry.actorUserId ?? null,
		actorLabel: entry.actorLabel ?? null,
		action: entry.action,
		targetType: entry.targetType ?? null,
		targetId: entry.targetId ?? null,
		metadata: entry.metadata ?? {},
	});
}

export async function listAudit(db: Database, limit = 50) {
	return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}
