-- Storage bucket for images re-hosted from Instagram/Facebook at curation
-- time (their own image links are signed and rot within hours-to-days — see
-- apps/curator/src/lib/image-rehost.ts). Public so apps/web can display
-- these directly by URL, same as any other hotlinked image today; the
-- curator only ever writes here with its service-role key, which bypasses
-- RLS/storage policy entirely, so no additional policy is needed for
-- inserts. No public.storage.objects policy is added because public-read
-- buckets already serve objects by URL without one.
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;
