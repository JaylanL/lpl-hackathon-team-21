export const GLOSSARY = {
  fiduciary: {
    en: 'A financial professional who must put your interests ahead of their own when giving advice or managing your money.',
    es: 'Un profesional financiero que debe poner sus intereses por encima de los propios al dar consejos o manejar su dinero.',
    zh: '提供建议或管理资金时，必须把您的利益放在自己利益之前的金融专业人士。',
  },
  aum: {
    en: 'Assets under management: the total value of investments a financial firm or advisor manages for clients.',
    es: 'Activos bajo gestión: el valor total de las inversiones que una firma o asesor financiero maneja para sus clientes.',
    zh: '管理资产：金融公司或顾问为客户管理的投资总价值。',
  },
  annuity: {
    en: 'A contract with an insurance company where you pay money, often in exchange for regular payments later in life.',
    es: 'Un contrato con una compañía de seguros en el que usted paga dinero, a menudo a cambio de pagos regulares más adelante.',
    zh: '您与保险公司签订的合同，先支付一笔钱，通常之后可以定期领取款项。',
  },
  'form crs': {
    en: 'A short document that explains a financial firm’s services, fees, conflicts of interest, and disciplinary history.',
    es: 'Un documento breve que explica los servicios, cargos, conflictos de interés e historial disciplinario de una firma financiera.',
    zh: '一份简短文件，说明金融公司的服务、费用、利益冲突和纪律处分记录。',
  },
  '401(k)': {
    en: 'A workplace retirement savings plan that lets you invest part of your paycheck, often with help from your employer.',
    es: 'Un plan de ahorro para la jubilación del trabajo que le permite invertir parte de su sueldo, a menudo con ayuda de su empleador.',
    zh: '一种工作场所退休储蓄计划，您可以投资部分工资，雇主通常也会提供帮助。',
  },
  diversification: {
    en: 'Spreading your money across different kinds of investments to reduce the harm if one performs poorly.',
    es: 'Repartir su dinero entre distintos tipos de inversiones para reducir el daño si alguna tiene malos resultados.',
    zh: '把资金分散投资于不同类型的项目，减少某项投资表现不佳时造成的损失。',
  },
  'risk tolerance': {
    en: 'How much loss or change in investment value you can handle while working toward your financial goals.',
    es: 'Cuánta pérdida o cambio en el valor de sus inversiones puede soportar mientras avanza hacia sus metas financieras.',
    zh: '在实现财务目标的过程中，您能够承受多大的损失或投资价值波动。',
  },
  'index fund': {
    en: 'A fund that aims to match the performance of a market list, such as the S&P 500, by holding many of its investments.',
    es: 'Un fondo que busca igualar el rendimiento de una lista del mercado, como el S&P 500, al tener muchas de sus inversiones.',
    zh: '一种基金，通过持有市场指数（如标普500）中的许多投资，力求取得相近的表现。',
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
