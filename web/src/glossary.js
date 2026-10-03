export const GLOSSARY = {
  fiduciary: {
    en: 'A financial professional who must put your interests ahead of their own when giving advice or managing your money.',
    es: 'Un profesional financiero que debe poner sus intereses por encima de los propios al dar consejos o manejar su dinero.',
  },
  aum: {
    en: 'Assets under management: the total value of investments a financial firm or advisor manages for clients.',
    es: 'Activos bajo gestión: el valor total de las inversiones que una firma o asesor financiero maneja para sus clientes.',
  },
  annuity: {
    en: 'A contract with an insurance company where you pay money, often in exchange for regular payments later in life.',
    es: 'Un contrato con una compañía de seguros en el que usted paga dinero, a menudo a cambio de pagos regulares más adelante.',
  },
  'form crs': {
    en: 'A short document that explains a financial firm’s services, fees, conflicts of interest, and disciplinary history.',
    es: 'Un documento breve que explica los servicios, cargos, conflictos de interés e historial disciplinario de una firma financiera.',
  },
  '401(k)': {
    en: 'A workplace retirement savings plan that lets you invest part of your paycheck, often with help from your employer.',
    es: 'Un plan de ahorro para la jubilación del trabajo que le permite invertir parte de su sueldo, a menudo con ayuda de su empleador.',
  },
  diversification: {
    en: 'Spreading your money across different kinds of investments to reduce the harm if one performs poorly.',
    es: 'Repartir su dinero entre distintos tipos de inversiones para reducir el daño si alguna tiene malos resultados.',
  },
  'risk tolerance': {
    en: 'How much loss or change in investment value you can handle while working toward your financial goals.',
    es: 'Cuánta pérdida o cambio en el valor de sus inversiones puede soportar mientras avanza hacia sus metas financieras.',
  },
  'index fund': {
    en: 'A fund that aims to match the performance of a market list, such as the S&P 500, by holding many of its investments.',
    es: 'Un fondo que busca igualar el rendimiento de una lista del mercado, como el S&P 500, al tener muchas de sus inversiones.',
  },
};

export function tagTerms(text) {
  const terms = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
  const candidates = [];

  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index + match[1].length;
      candidates.push({ term, start, end: start + match[2].length });
      // The lookahead can match without consuming the following boundary;
      // the term itself is always non-empty, so the regex advances safely.
    }
  }

  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const matches = [];
  let claimedEnd = -1;
  for (const candidate of candidates) {
    if (candidate.start >= claimedEnd) {
      matches.push(candidate);
      claimedEnd = candidate.end;
    }
  }
  return matches;
}
