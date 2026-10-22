-- As regras do bucket "suporte" não podem quebrar outros buckets: converte a pasta para uuid com segurança.
create or replace function public.uuid_ou_nulo(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.uuid_ou_nulo(text) to authenticated;

drop policy if exists "suporte envia arquivo" on storage.objects;
drop policy if exists "suporte vê arquivo" on storage.objects;
create policy "suporte envia arquivo" on storage.objects for insert to authenticated
  with check (bucket_id = 'suporte' and (public.eh_atendente() or public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1]))));
create policy "suporte vê arquivo" on storage.objects for select to authenticated
  using (bucket_id = 'suporte' and (public.eh_atendente() or public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1]))));
