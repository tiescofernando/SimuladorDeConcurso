-- Execute no SQL Editor do seu projeto Supabase. Pode ser executado novamente.
begin;
create table if not exists public.simulador_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.simulador_conteudo (
  id integer primary key check (id = 1),
  dados jsonb not null check (
    jsonb_typeof(dados) = 'object'
    and dados ?& array['questoes', 'apostilas', 'disciplinas', 'simulados']
    and jsonb_typeof(dados->'questoes') = 'array'
    and jsonb_typeof(dados->'apostilas') = 'array'
    and jsonb_typeof(dados->'disciplinas') = 'array'
    and jsonb_typeof(dados->'simulados') = 'array'
  ),
  versao integer not null default 1,
  atualizado_em timestamptz not null default now()
);
alter table public.simulador_admins enable row level security;
alter table public.simulador_conteudo enable row level security;
revoke all on public.simulador_admins, public.simulador_conteudo from anon, authenticated;
grant select on public.simulador_admins to authenticated;
grant select on public.simulador_conteudo to anon, authenticated;
grant insert, update on public.simulador_conteudo to authenticated;

drop policy if exists admin_consulta_propria on public.simulador_admins;
create policy admin_consulta_propria on public.simulador_admins for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists conteudo_publico on public.simulador_conteudo;
create policy conteudo_publico on public.simulador_conteudo for select to anon, authenticated using (true);
drop policy if exists admin_insere on public.simulador_conteudo;
create policy admin_insere on public.simulador_conteudo for insert to authenticated
  with check (exists (select 1 from public.simulador_admins where user_id = (select auth.uid())));
drop policy if exists admin_atualiza on public.simulador_conteudo;
create policy admin_atualiza on public.simulador_conteudo for update to authenticated
  using (exists (select 1 from public.simulador_admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.simulador_admins where user_id = (select auth.uid())));

-- Uma publicação é atômica. Uma versão antiga nunca sobrescreve a nova via RPC.
create or replace function public.salvar_simulador(novos_dados jsonb, versao_esperada integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare nova_versao integer;
begin
  if not exists (select 1 from public.simulador_admins where user_id = (select auth.uid())) then
    raise insufficient_privilege using message = 'Administrador necessário';
  end if;
  if versao_esperada = 0 then
    insert into public.simulador_conteudo (id, dados, versao) values (1, novos_dados, 1)
      on conflict (id) do nothing returning versao into nova_versao;
  else
    update public.simulador_conteudo set dados = novos_dados, versao = versao + 1, atualizado_em = now()
      where id = 1 and versao = versao_esperada returning versao into nova_versao;
  end if;
  if nova_versao is null then raise exception 'version_conflict'; end if;
  return nova_versao;
end;
$$;
revoke all on function public.salvar_simulador(jsonb, integer) from public, anon;
grant execute on function public.salvar_simulador(jsonb, integer) to authenticated;
commit;

-- Depois de criar o usuário em Authentication > Users, execute separadamente:
-- insert into public.simulador_admins (user_id)
-- select id from auth.users where email = 'SEU_EMAIL' on conflict do nothing;
