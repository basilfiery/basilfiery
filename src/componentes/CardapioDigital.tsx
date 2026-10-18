import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Download, ExternalLink, MessageCircle, Printer, Smartphone, X } from 'lucide-react';
import { Modal } from './Modal';
import { Switch } from './Basicos';
import { BotaoCopiar } from './Link';
import { useToast } from './Toast';
import { msgErro, supabase } from '../lib/supabase';
import type { RestauranteComPapel } from '../lib/tipos';

export const linkLoja = (codigo: string) => `${window.location.origin}/loja/${codigo}`;

/**
 * "O link do seu Cardápio Digital": abre ao clicar na empresa (canto superior direito).
 * Link do delivery para copiar, mandar no WhatsApp ou abrir, e QR code para baixar/imprimir.
 */
export function ModalCardapioDigital({ restaurante, gestor, aoMudarDelivery, aoFechar, rodape }: {
  restaurante: RestauranteComPapel;
  gestor: boolean;
  aoMudarDelivery: (ativo: boolean) => void;
  aoFechar: () => void;
  rodape?: ReactNode;
}) {
  const toast = useToast();
  const link = linkLoja(restaurante.codigo);
  const [qr, setQr] = useState('');
  const [ativo, setAtivo] = useState(restaurante.delivery_ativo);

  useEffect(() => {
    void QRCode.toDataURL(link, { width: 640, margin: 1, color: { dark: '#14110f', light: '#ffffff' } }).then(setQr);
  }, [link]);

  const whats = `https://wa.me/?text=${encodeURIComponent(`Peça pelo nosso cardápio digital: ${link}`)}`;

  async function alternar(v: boolean) {
    setAtivo(v);
    const { error } = await supabase.from('restaurantes').update({ delivery_ativo: v }).eq('id', restaurante.id);
    if (error) {
      setAtivo(!v);
      return toast(msgErro(error), 'erro');
    }
    aoMudarDelivery(v);
    toast(v ? 'Loja aberta: já pode receber pedidos de casa.' : 'Loja fechada para pedidos de casa.', 'ok');
  }

  function imprimir() {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return toast('Libere as janelas pop-up para imprimir.', 'erro');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Code · ${restaurante.nome}</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#111}h1{margin:0 0 4px;font-size:26px}
      p{margin:0 0 18px;color:#444}img{width:320px;height:320px}small{display:block;margin-top:14px;color:#666;font-size:13px}</style></head>
      <body><h1>${restaurante.nome}</h1><p>Aponte a câmera e faça seu pedido</p><img src="${qr}" alt=""><small>${link}</small>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script></body></html>`);
    w.document.close();
  }

  return (
    <Modal aberto aoFechar={aoFechar} largura={460} classe="cd-modal">
      <button className="cd-fechar" onClick={aoFechar} aria-label="Fechar"><X size={22} /></button>
      <div className="cd-topo" aria-hidden="true">
        <div className="cd-celular">
          <div className="cd-celular__tela">
            <span className="cd-celular__busca" />
            <span className="cd-celular__loja">{restaurante.logo_url ? <img src={restaurante.logo_url} alt="" /> : <b>{restaurante.nome.charAt(0)}</b>}{restaurante.nome}</span>
            <span className="cd-celular__abas"><i /><i /><i /></span>
            <span className="cd-celular__item" /><span className="cd-celular__item" />
          </div>
        </div>
      </div>
      <div className="cd-corpo">
        <h2>O link do seu Cardápio Digital</h2>
        <p>Copie o link e cole onde quiser: WhatsApp, Instagram, Google. O cliente pede de casa, para entrega ou retirada.</p>
        <div className="cd-link" title={link}>{link.replace(/^https?:\/\//, '')}</div>
        <div className="cd-botoes">
          <a className="btn btn--contorno" href={whats} target="_blank" rel="noopener"><MessageCircle size={18} /> Enviar link</a>
          <BotaoCopiar texto={link} classe="cd-copiar" />
        </div>
        <a className="cd-abrir" href={link} target="_blank" rel="noopener"><ExternalLink size={15} /> Abrir cardápio</a>

        {gestor && (
          <div className={`cd-status ${ativo ? 'aberta' : ''}`}>
            <Smartphone size={18} />
            <span><b>{ativo ? 'Recebendo pedidos de casa' : 'Loja fechada para pedidos'}</b><small>{ativo ? 'Desligue quando parar de atender.' : 'Os clientes veem o cardápio, mas não conseguem pedir.'}</small></span>
            <Switch marcado={ativo} aoMudar={(v) => void alternar(v)} />
          </div>
        )}
      </div>
      <div className="cd-qr">
        <div className="cd-qr__cartao">
          {qr ? <img src={qr} alt="QR code do cardápio digital" /> : <span className="cd-qr__vazio" />}
          <div>
            <strong>Cardápio digital para redes sociais</strong>
            <small>Escaneie o QR Code com o celular e faça seu pedido.</small>
          </div>
        </div>
        <div className="cd-qr__acoes">
          {qr && <a className="icone-btn" href={qr} download={`cardapio-${restaurante.codigo}.png`} title="Baixar QR code" aria-label="Baixar QR code"><Download size={18} /></a>}
          <button className="icone-btn" onClick={imprimir} title="Imprimir QR code" aria-label="Imprimir QR code" disabled={!qr}><Printer size={18} /></button>
        </div>
      </div>
      {rodape && <div className="cd-rodape">{rodape}</div>}
    </Modal>
  );
}
