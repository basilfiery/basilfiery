-- Foto de perfil do cliente do cardápio digital (fica em imagens/avatars/<id>/)
alter table public.clientes_perfis add column if not exists foto_url text check (foto_url is null or char_length(foto_url) <= 500);
