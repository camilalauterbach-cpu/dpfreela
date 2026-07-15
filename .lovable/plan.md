# Entrega 11 — Convites públicos ativados

Backend: RPCs `create_invite_record` / `revoke_invite` / `resend_invite` (service_role only) + Edge Functions `invite-create`, `invite-revoke`, `invite-resend` (verify_jwt=true, admin/manager) + `public-invite-accept` (verify_jwt=false, fail-closed sem `INVITE_TOKEN_SECRET`).

Token: gerado exclusivamente na Edge Function (32 bytes, base64url). O banco só armazena `sha256(INVITE_TOKEN_SECRET + ":" + token)`. O token aparece uma única vez no link retornado. Reenvio revoga o anterior e emite novo token.

CORS: lista via `INVITE_ALLOWED_ORIGINS`, sem wildcard, sem fallback para domínio de produção. Origem não permitida → sem `Access-Control-Allow-Origin`.

Papéis permitidos em convites públicos: `viewer` e `operator`. TTL 1-168h (padrão 72). Duplicidade pending/processing bloqueada. Convite aceito não pode ser revogado ou reenviado.

UI: aba **Convites** em `/settings/invites` (admin/manager) e rota pública `/invite/:token` (senha, confirmação, remoção do token da URL após uso).

Auditoria: `invite_created`, `invite_revoked`, `invite_resent`, `invite_accepted` — nunca token, hash, senha ou e-mail em payloads.

Rollback: revogar RPCs, remover Edge Functions administrativas, apagar secrets `INVITE_TOKEN_SECRET`/`INVITE_ALLOWED_ORIGINS`/`INVITE_PUBLIC_BASE_URL` e reverter `change_logs_action_check`.
