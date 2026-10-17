-- Foto de perfil da equipe (o próprio garçom coloca a foto e ajusta o nome)
alter table public.membros add column foto_url text check (char_length(foto_url) <= 600);

create function public.meu_perfil_atualizar(p_nome text, p_foto_url text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_nome text := left(trim(p_nome), 60);
begin
  if (select auth.uid()) is null then raise exception 'Faça login novamente'; end if;
  if v_nome is null or v_nome = '' then raise exception 'Informe seu nome'; end if;
  if p_foto_url is not null and p_foto_url !~ '^https://' then raise exception 'Foto inválida'; end if;
  update public.membros set nome = v_nome, foto_url = p_foto_url where user_id = (select auth.uid());
end $$;

revoke execute on function public.meu_perfil_atualizar(text, text) from public, anon;
grant execute on function public.meu_perfil_atualizar(text, text) to authenticated;

-- Cada pessoa só envia/troca a própria foto: imagens/avatars/<seu id>/...
create policy "envia a propria foto" on storage.objects for insert to authenticated
  with check (bucket_id = 'imagens' and (storage.foldername(name))[1] = 'avatars'
              and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "troca a propria foto" on storage.objects for update to authenticated
  using (bucket_id = 'imagens' and (storage.foldername(name))[1] = 'avatars'
         and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "apaga a propria foto" on storage.objects for delete to authenticated
  using (bucket_id = 'imagens' and (storage.foldername(name))[1] = 'avatars'
         and (storage.foldername(name))[2] = (select auth.uid())::text);
