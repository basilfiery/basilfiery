-- Reserva o próximo número da NFC-e/NF-e (só a função "fiscal", com a chave de serviço, chama)
create or replace function public.fiscal_reservar_numero(p_rest uuid, p_modelo int)
returns table (serie int, numero int) language plpgsql security definer set search_path = '' as $$
begin
  if p_modelo = 65 then
    return query update public.fiscal_config f set nfce_proximo = f.nfce_proximo + 1
      where f.restaurante_id = p_rest returning f.nfce_serie, f.nfce_proximo - 1;
  else
    return query update public.fiscal_config f set nfe_proximo = f.nfe_proximo + 1
      where f.restaurante_id = p_rest returning f.nfe_serie, f.nfe_proximo - 1;
  end if;
end $$;
revoke execute on function public.fiscal_reservar_numero(uuid, int) from public, anon, authenticated;
grant execute on function public.fiscal_reservar_numero(uuid, int) to service_role;
