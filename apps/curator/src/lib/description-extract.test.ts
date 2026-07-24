import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDescription, type DescriptionConfig } from "./description-extract.js";

const UCHILE_CONFIG: DescriptionConfig = {
  pattern: /<div class="content__description"[^>]*>([\s\S]*?)<\/div>\s*<!--\/ description -->/,
};

const MNBA_CONFIG: DescriptionConfig = {
  pattern: /<div class="text-long">([\s\S]*?)<\/div>/,
};

const ARTEINFORMADO_CONFIG: DescriptionConfig = {
  pattern: /<span class="event-text">([\s\S]*?)<\/span>/,
};

test("extractDescription strips nested tags, decodes Spanish HTML entities, and collapses whitespace (real artes.uchile.cl detail-page markup)", () => {
  // Real markup shape, confirmed 2026-07-24 against a live artes.uchile.cl
  // detail page — leads with an <img> inside its own empty-ish <p>, then
  // real prose paragraphs with accented-character entities.
  const html =
    '<div class="content__description" itemprop="description">\n' +
    '<p><img alt="Muestra" src="/dam/foto.jpg" /></p>\n\n' +
    "<p>Constanza Alarc&oacute;n Tennen</p>\n\n" +
    "<p>Subducci&oacute;n es el tipo de interacci&oacute;n entre las placas.</p>\n" +
    "                </div>\n" +
    "                <!--/ description -->\n" +
    "                <!--/ credit -->";

  const result = extractDescription(html, UCHILE_CONFIG);
  assert.equal(result, "Constanza Alarcón Tennen Subducción es el tipo de interacción entre las placas.");
});

test("extractDescription reads mnba.gob.cl's real markup shape, stopping at the first closing </div> (no nested divs inside)", () => {
  const html =
    '<div class="text-long"><p><span>En el marco de sus 145 años, el Museo dedica la Sala Chile.</span></p></div>\n' +
    '      \n  </div>\n<div  class="grid__item--footer">';

  const result = extractDescription(html, MNBA_CONFIG);
  assert.equal(result, "En el marco de sus 145 años, el Museo dedica la Sala Chile.");
});

test("extractDescription reads arteinformado.com's real markup shape — plain text with no nested tags inside the span", () => {
  const html =
    '<span class="text-uppercase">Descripción de la Exposición</span><br /><br />\n' +
    '    <span class="event-text">MAC celebra 50 años de su fototeca.\n\n80 artistas son parte de la muestra.</span>\n' +
    "</p>";

  const result = extractDescription(html, ARTEINFORMADO_CONFIG);
  assert.equal(result, "MAC celebra 50 años de su fototeca. 80 artistas son parte de la muestra.");
});

test("extractDescription returns null when the pattern doesn't match at all", () => {
  assert.equal(extractDescription("<div>algo distinto</div>", UCHILE_CONFIG), null);
});

test("extractDescription returns null when the captured group strips down to empty text (e.g. only an image, no prose)", () => {
  const html = '<div class="text-long"><img src="/solo-imagen.jpg" /></div>';
  assert.equal(extractDescription(html, MNBA_CONFIG), null);
});
