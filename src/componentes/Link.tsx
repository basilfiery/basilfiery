import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, ExternalLink, Link2 } from 'lucide-react';
import { useToast } from './Toast';
import { cx } from '../lib/util';

async function copiarTexto(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Navegador sem permissão de área de transferência: cai no jeito antigo
    const campo = document.createElement('textarea');
    campo.value = texto;
    campo.style.position = 'fixed';
    campo.style.opacity = '0';
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand('copy');
    campo.remove();
    return ok;
  }
}

/** Botão "Copiar" que vira "Copiado" por alguns segundos. */
export function BotaoCopiar({ texto, rotulo = 'Copiar', classe, aoCopiar }: { texto: string; rotulo?: string; classe?: string; aoCopiar?: () => void }) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2200);
    return () => clearTimeout(t);
  }, [copiado]);

  return (
    <button
      type="button"
      className={cx('btn-copiar', copiado && 'btn-copiar--ok', classe)}
      onClick={() => void copiarTexto(texto).then((ok) => {
        if (!ok) return toast('Não foi possível copiar. Segure o link para copiar manualmente.', 'erro');
        setCopiado(true);
        aoCopiar?.();
      })}
    >
      {copiado ? <Check size={16} /> : <Copy size={16} />}
      <span>{copiado ? 'Copiado' : rotulo}</span>
    </button>
  );
}

/**
 * Link pronto para copiar: mostra o endereço sem estourar a largura
 * (o começo some com reticências e o final — a parte que importa — fica visível).
 */
export function LinkCopiavel({ link, abrir = true, compacto }: { link: string; abrir?: boolean; compacto?: boolean }) {
  const semProtocolo = link.replace(/^https?:\/\//, '');
  const barra = semProtocolo.indexOf('/');
  const dominio = barra >= 0 ? semProtocolo.slice(0, barra) : semProtocolo;
  const caminho = barra >= 0 ? semProtocolo.slice(barra) : '';

  return (
    <div className={cx('link-copiavel', compacto && 'link-copiavel--compacto')}>
      <span className="link-copiavel__icone" aria-hidden="true"><Link2 size={16} /></span>
      <span className="link-copiavel__texto" title={link}>
        <span className="link-copiavel__dominio">{dominio}</span>
        <span className="link-copiavel__caminho">{caminho}</span>
      </span>
      {abrir && (
        <a className="link-copiavel__abrir" href={link} target="_blank" rel="noopener" title="Abrir em outra aba" aria-label="Abrir link">
          <ExternalLink size={16} />
        </a>
      )}
      <BotaoCopiar texto={link} />
    </div>
  );
}

/** QR code emoldurado, com legenda e botão para baixar (para imprimir e colar na mesa, por exemplo). */
export function QrCartao({ link, legenda, arquivo }: { link: string; legenda?: string; arquivo: string }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let vivo = true;
    void QRCode.toDataURL(link, { width: 640, margin: 1, color: { dark: '#14110f', light: '#ffffff' } }).then((u) => vivo && setQr(u));
    return () => { vivo = false; };
  }, [link]);

  return (
    <figure className="qr-cartao">
      <div className="qr-cartao__moldura">
        {qr ? <img src={qr} alt={legenda ?? 'QR code'} /> : <span className="qr-cartao__vazio" />}
      </div>
      <figcaption>
        {legenda && <span>{legenda}</span>}
        {qr && (
          <a className="qr-cartao__baixar" href={qr} download={`${arquivo}.png`}>
            <Download size={15} /> Baixar QR code
          </a>
        )}
      </figcaption>
    </figure>
  );
}
