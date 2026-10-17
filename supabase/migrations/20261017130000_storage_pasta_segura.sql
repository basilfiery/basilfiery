-- As regras de imagem do restaurante convertiam a 1ª pasta em uuid. Com a pasta
-- "avatars" (fotos de perfil) isso dava erro e bloqueava o envio. Agora só converte
-- quando a pasta é de fato um id de restaurante.
create or replace function public.pasta_restaurante(p_nome text)
returns uuid language sql immutable as $$
  select case when (storage.foldername(p_nome))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((storage.foldername(p_nome))[1])::uuid end
$$;

drop policy "gestor envia imagens" on storage.objects;
drop policy "gestor troca imagens" on storage.objects;
drop policy "gestor apaga imagens" on storage.objects;
create policy "gestor envia imagens" on storage.objects for insert to authenticated
  with check (bucket_id = 'imagens' and public.tem_papel(public.pasta_restaurante(name), '{dono,gerente}'));
create policy "gestor troca imagens" on storage.objects for update to authenticated
  using (bucket_id = 'imagens' and public.tem_papel(public.pasta_restaurante(name), '{dono,gerente}'));
create policy "gestor apaga imagens" on storage.objects for delete to authenticated
  using (bucket_id = 'imagens' and public.tem_papel(public.pasta_restaurante(name), '{dono,gerente}'));
