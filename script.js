const API_URL =
  "https://script.google.com/macros/s/AKfycbwCCgzR89n5wLrSRkWqCCZDLAvzbWwx9Y-3Dhn5QpHf2NSXFhoKdjkJmN_wG-EZKqu6/exec";


// ====================================
// LAPUS LABELS
// ====================================
const LAPUS_LABELS = {

  A: "Pertanian, Kehutanan, dan Perikanan",

  B: "Pertambangan dan Penggalian",

  C: "Industri Pengolahan",

  D: "Pengadaan Listrik dan Gas",

  E: "Pengadaan Air, Pengelolaan Sampah, Limbah dan Daur Ulang",

  F: "Konstruksi",

  G: "Perdagangan Besar dan Eceran; Reparasi Mobil dan Sepeda Motor",

  H: "Transportasi dan Pergudangan",

  I: "Penyediaan Akomodasi dan Makan Minum",

  J: "Informasi dan Komunikasi",

  K: "Jasa Keuangan dan Asuransi",

  L: "Real Estat",

  MN: "Jasa Perusahaan",

  O: "Administrasi Pemerintahan, Pertahanan dan Jaminan Sosial Wajib",

  P: "Jasa Pendidikan",

  Q: "Jasa Kesehatan dan Kegiatan Sosial",

  RSTU: "Jasa Lainnya"
};


// ====================================
// GLOBAL STATE
// ====================================
let lastParams = {};

let currentRows = [];

const CLIENT_PAGE_SIZE = 10;


// ====================================
// FORMAT DATE
// ====================================
function formatDateIndo(dateString) {

  const d = new Date(dateString);

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }
  ).format(d);
}


// ====================================
// SEARCH
// ====================================
function search(page = 1) {

  if (
    !f_title.checked &&
    !f_summary.checked &&
    !f_full.checked
  ) {

    alert(
      "Please select at least one search field."
    );

    return;
  }


  if (
    date_to.value &&
    date_from.value &&
    date_to.value < date_from.value
  ) {

    alert(
      '"To date" cannot be earlier than "From date"'
    );

    return;
  }


  lastParams = {

    action: "searchNews",

    keyword: keyword.value,

    region: region.value,

    lapus: lapus.value,

    pdrb_relevan:
      pdrb_only.checked,

    event_time:
      Array.from(
        document.querySelectorAll(
          ".event_filter:checked"
        )
      ).map(cb => cb.value).join(","),

    date_from:
      date_from.value,

    date_to:
      date_to.value,

    page: 1,

    pageSize: 100000,

    f_title:
      f_title.checked,

    f_summary:
      f_summary.checked,

    f_full:
      f_full.checked
  };


  result.innerHTML =
    `
    <div class="news-card">
      Loading...
    </div>
    `;


  fetch(
    API_URL + "?" +
    new URLSearchParams(lastParams)
  )

  .then(res => res.json())

  .then(data => {

    currentRows = data.rows || [];

    renderPage(1);
  })

  .catch(err => {

    console.error(err);

    result.innerHTML =
      `
      <div class="news-card">
        Failed to load data
      </div>
      `;
  });
}


// ====================================
// CLIENT PAGINATION
// ====================================
function renderPage(page = 1) {

  const totalFound =
    currentRows.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalFound /
        CLIENT_PAGE_SIZE
      )
    );

  const start =
    (page - 1) *
    CLIENT_PAGE_SIZE;

  const end =
    start +
    CLIENT_PAGE_SIZE;

  const rows =
    currentRows.slice(
      start,
      end
    );


  meta.innerHTML =
    `
    Found
    <b>${totalFound}</b>
    articles
    `;


  if (!rows.length) {

    result.innerHTML =
      `
      <div class="news-card">
        No results found.
      </div>
      `;

    pager.innerHTML = "";

    return;
  }


  let html = "";


  rows.forEach((r) => {

    const formattedDate =
      formatDateIndo(
        r.publication_datetime
      );

    const citationText =
      `${r.title} (${r.source}, ${formattedDate})`;

    const summaryText =
      `${r.title}\n\n${r.summary}`;

    const lapusTooltip =
      LAPUS_LABELS[r.lapus] ||
      r.lapus ||
      "-";


    html += `

      <article class="news-card">

        <div class="news-header">

          <div>

            <h3 class="news-title">

              <a
                href="${r.url}"
                target="_blank"
              >
                ${r.title}
              </a>

            </h3>

            <div class="news-meta">

              ${r.source}
              •
              ${formattedDate}
              •
              ${r.region || "-"}

            </div>

          </div>

        </div>


        <div class="news-summary">

          ${r.summary || "-"}

          <span
            class="tooltip info-icon"
            data-tooltip="
              Summary generated using AI.
              Please verify if needed.
            "
          >
            i
          </span>

        </div>


        <div class="badges">

          <span
            class="
              badge
              tooltip
              ${
                r.pdrb_relevan === "YA"
                ? "badge-green"
                : "badge-gray"
              }
            "

            data-tooltip="
              PDRB relevance generated using AI classification.
              Please verify if needed.
            "
          >

            PDRB:
            ${r.pdrb_relevan || "TIDAK"}

          </span>


          ${
            r.lapus
            ? `
              <span
                class="
                  badge
                  badge-blue
                  tooltip
                "

                data-tooltip="
                  ${lapusTooltip}

                  Generated using trained
                  Machine Learning model.
                "
              >

                Lapus:
                ${r.lapus}

              </span>
            `
            : ""
          }


          ${
            r.event_time
            ? `
              <span
                class="
                  badge
                  badge-gray
                  tooltip
                "

                data-tooltip="
                  Event status generated using AI extraction.
                  Please verify if needed.
                "
              >

                ${r.event_time}

              </span>
            `
            : ""
          }

        </div>


        <div class="card-actions">

          <button
            class="card-btn"
            onclick='copyText(
              ${JSON.stringify(citationText)}
            )'
          >
            Copy Citation
          </button>


          <button
            class="card-btn"
            onclick='copyText(
              ${JSON.stringify(summaryText)}
            )'
          >
            Copy Summary
          </button>


          <button
            class="card-btn"
            onclick="toggleArticle(this)"
          >
            Full Article
          </button>

        </div>


        <div class="full-article">${r.content || "-"}</div>

      </article>
    `;
  });


  result.innerHTML = html;

  renderPager(
    page,
    totalPages
  );


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


// ====================================
// PAGER
// ====================================
function renderPager(
  page,
  totalPages
) {

  let html = "";


  if (page > 1) {

    html += `
      <button
        onclick="renderPage(${page - 1})"
      >
        Prev
      </button>
    `;
  }


  for (
    let i = 1;
    i <= totalPages;
    i++
  ) {

    if (
      i >= page - 2 &&
      i <= page + 2
    ) {

      html += `
        <button
          class="
            ${i === page ? 'active' : ''}
          "

          onclick="renderPage(${i})"
        >
          ${i}
        </button>
      `;
    }
  }


  if (page < totalPages) {

    html += `
      <button
        onclick="renderPage(${page + 1})"
      >
        Next
      </button>
    `;
  }


  pager.innerHTML = html;
}


// ====================================
// COPY
// ====================================
function copyText(text) {

  navigator.clipboard.writeText(text);

}


// ====================================
// TOGGLE ARTICLE
// ====================================
function toggleArticle(btn) {

  const article =
    btn.parentElement
      .nextElementSibling;

  article.classList.toggle("show");

  btn.textContent =
    article.classList.contains("show")
      ? "Hide Article"
      : "Full Article";
}


// ====================================
// RESET
// ====================================
function resetSearch() {

  keyword.value = "";

  region.value = "";

  lapus.value = "";

  pdrb_only.checked = true;

  f_title.checked = true;

  f_summary.checked = true;

  f_full.checked = false;

  document
    .querySelectorAll(".event_filter")
    .forEach(
      cb => cb.checked = true
    );

  // Reset default dates
  date_from.value = "2026-03-01";

  date_to.value = "2026-03-31";

  search(1);
}


// ====================================
// DATE RANGE
// ====================================
function loadDateRange() {

  fetch(
    API_URL +
    "?action=getDateRange"
  )

  .then(res => res.json())

  .then(range => {

    if (
      !range ||
      !range.dataset_min
    ) {

      search(1);

      return;
    }


    date_from.min =
      range.dataset_min;

    date_to.min =
      range.dataset_min;

    date_from.max =
      range.max;

    date_to.max =
      range.max;


    date_from.value =
      range.default_from;

    date_to.value =
      range.max;


    search(1);
  });
}


// ====================================
// MOBILE SIDEBAR
// ====================================
const sidebar =
  document.getElementById(
    "sidebar"
  );

const overlay =
  document.getElementById(
    "sidebarOverlay"
  );


document
  .getElementById(
    "mobileMenuBtn"
  )

  .addEventListener(
    "click",
    () => {

      sidebar.classList.add(
        "open"
      );

      overlay.classList.add(
        "show"
      );
    }
  );


document
  .getElementById(
    "closeSidebarBtn"
  )

  .addEventListener(
    "click",
    closeSidebar
  );


overlay.addEventListener(
  "click",
  closeSidebar
);


function closeSidebar() {

  sidebar.classList.remove(
    "open"
  );

  overlay.classList.remove(
    "show"
  );
}


// ====================================
// AUTO SEARCH EVENTS
// ====================================
[
  "region",
  "lapus",
  "date_from",
  "date_to",
  "pdrb_only",
  "f_title",
  "f_summary",
  "f_full"
]

.forEach(id => {

  document
    .getElementById(id)

    .addEventListener(
      "change",
      () => search(1)
    );
});


document
  .querySelectorAll(
    ".event_filter"
  )

  .forEach(cb => {

    cb.addEventListener(
      "change",
      () => search(1)
    );
  });


keyword.addEventListener(
  "keydown",
  e => {

    if (e.key === "Enter") {

      search(1);
    }
  }
);


// ====================================
// DATE VALIDATION
// ====================================
date_from.addEventListener(
  "change",
  function () {

    if (this.value) {

      date_to.min = this.value;


      if (
        date_to.value &&
        date_to.value < this.value
      ) {

        date_to.value = "";
      }
    }
  }
);


date_to.addEventListener(
  "change",
  function () {

    if (
      this.value &&
      this.value < date_from.value
    ) {

      this.value = "";
    }
  }
);


// ====================================
// FIRST LOAD
// ====================================
window.onload = () => {

  // Default dates
  date_from.value = "2026-03-01";

  date_to.value = "2026-03-31";

  // Allowed limits
  date_from.min = "2025-10-01";
  date_to.min = "2025-10-01";

  date_from.max = "2026-03-31";
  date_to.max = "2026-03-31";

  search(1);
};
