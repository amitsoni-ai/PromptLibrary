// Fire-and-forget writers for the three trails. Never throw into a request.
import { clientIp, userAgent } from "./_http.js";

export function authEvent(sql, { userId, email, event, req, meta }) {
  sql`insert into auth_events (user_id, email_norm, event, ip, user_agent, meta)
      values (${userId || null}, ${(email || "").toLowerCase() || null}, ${event},
              ${req ? clientIp(req) : null}, ${req ? userAgent(req) : null},
              ${JSON.stringify(meta || {})})`.catch(() => {});
}

export function auditLog(sql, { actorType = "system", actorId, actorLabel, action, targetType, targetId, detail, req }) {
  sql`insert into audit_logs (actor_type, actor_id, actor_label, action, target_type, target_id, detail, ip)
      values (${actorType}, ${actorId || null}, ${actorLabel || null}, ${action},
              ${targetType || null}, ${targetId || null}, ${JSON.stringify(detail || {})},
              ${req ? clientIp(req) : null})`.catch(() => {});
}

export function entitlementEvent(sql, { userId, actor, action, detail }) {
  sql`insert into entitlement_events (user_id, actor, action, detail)
      values (${userId || null}, ${actor || "system"}, ${action}, ${JSON.stringify(detail || {})})`.catch(() => {});
}
