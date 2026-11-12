begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('apostilas', 'apostilas', true, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- Arquivos públicos para os estudantes. Inclusão e gestão somente por admins.
create policy apostilas_admin_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'apostilas'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.simulador_admins where user_id = (select auth.uid()))
);
create policy apostilas_admin_select on storage.objects for select to authenticated
using (
  bucket_id = 'apostilas'
  and exists (select 1 from public.simulador_admins where user_id = (select auth.uid()))
);
create policy apostilas_admin_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'apostilas'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.simulador_admins where user_id = (select auth.uid()))
);
commit;
