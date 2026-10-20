-- Os gatilhos do endereço (slug) rodam com o dono da função: funcionam também
-- quando a loja é criada pelo servidor (ativação da assinatura, plataforma).
alter function privado.restaurante_slug() security definer set search_path = public, privado;
alter function privado.slug_principal_protegido() security definer set search_path = public, privado;
alter function privado.slug_livre(text, uuid) security definer set search_path = public, privado;
