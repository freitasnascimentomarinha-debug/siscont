create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb ->> 'role' $$;
grant usage on schema auth to authenticated, service_role, anon;
grant execute on all functions in schema auth to authenticated, service_role, anon;
create table public.profiles (id uuid primary key, name text, role text);
create table public.invoices (id uuid primary key, value numeric);
create table public.clients (id uuid primary key, name text);
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@mb.br','{"name":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000b','oper@mb.br','{"name":"Oper"}'),
 ('00000000-0000-0000-0000-00000000000c','leitor@mb.br','{"name":"Leitor"}'),
 ('00000000-0000-0000-0000-00000000000d','semperfil@mb.br','{"name":"Sem Perfil"}');
insert into public.profiles values
 ('00000000-0000-0000-0000-00000000000a','Admin','ADMIN'),
 ('00000000-0000-0000-0000-00000000000b','Oper','USER'),
 ('00000000-0000-0000-0000-00000000000c','Leitor',null),
 ('99999999-0000-0000-0000-000000000000','Fantasma (tela antiga)','USER');
insert into public.invoices values ('11111111-0000-0000-0000-000000000001', 100);
create policy legado_tudo on public.invoices for all using (true);
grant all on all tables in schema public to authenticated, service_role;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$;
