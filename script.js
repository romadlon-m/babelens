const API_URL =
  "https://script.google.com/macros/s/AKfycbwCCgzR89n5wLrSRkWqCCZDLAvzbWwx9Y-3Dhn5QpHf2NSXFhoKdjkJmN_wG-EZKqu6/exec";

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

  const params = {

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

    page,

    pageSize: 25,

    f_title:
      f_title.checked,

    f_summary:
      f_summary.checked,

    f_full:
      f_full.checked
  };


  result.innerHTML =
    `<div class="news-card">
      Loading...
    </div>`;


  fetch(
    API_URL + "?" +
    new URLSearchParams(params)
  )

  .then(res => res.json())

  .then(render)

  .catch(err => {

    console.error(err);

    result.innerHTML =
      `<div class="news-card">
        Failed to load data
      </div>`;
  });
}


// ====================================
// RENDER
// ====================================
function render(data) {

  meta.innerHTML =
    `Found <b>${data.totalFound}</b>
    articles`;

  if (!data.rows.length) {

    result.innerHTML =
      `<div class="news-card">
        No results found.
      </div>`;

    return;
  }

  let html = "";

  data.rows.forEach((r, i) => {

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
              ${r.publication_datetime}
              •
              ${r.region || "-"}

            </div>

          </div>

        </div>


        <div class="news-summary">
          ${r.summary || "-"}
        </div>


        <div class="badges">

          <span class="
            badge
            ${r.pdrb_relevan === "YA"
              ? "badge-green"
              : "badge-gray"}
          ">
            PDRB:
            ${r.pdrb_relevan || "TIDAK"}
          </span>


          ${
            r.lapus
            ? `
              <span class="
                badge
                badge-blue
              ">
                Lapus:
                ${r.lapus}
              </span>
            `
            : ""
          }


          ${
            r.event_time
            ? `
              <span class="
                badge
                badge-gray
              ">
                ${r.event_time}
              </span>
            `
            : ""
          }

        </div>


        <div class="card-actions">

          <button
            class="card-btn"
            onclick="copySummary(this)"
            data-copy="
              ${(
                r.title +
                ' — ' +
                r.summary
              ).replace(/"/g, '&quot;')}
            "
          >
            Copy
          </button>


          <button
            class="card-btn"
            onclick="toggleArticle(this)"
          >
            Full Article
          </button>

        </div>


        <div class="full-article">

          ${r.content || "-"}

        </div>

      </article>
    `;
  });

  result.innerHTML = html;

  renderPager(data);
}


// ====================================
// PAGER
// ====================================
function renderPager(data) {

  const {
    page,
    totalPages
  } = data;

  let html = "";

  if (page > 1) {

    html += `
      <button
        onclick="search(${page - 1})"
      >
        Prev
      </button>
    `;
  }

  for (let i = 1; i <= totalPages; i++) {

    if (
      i >= page - 2 &&
      i <= page + 2
    ) {

      html += `
        <button
          class="
            ${i === page ? 'active' : ''}
          "
          onclick="search(${i})"
        >
          ${i}
        </button>
      `;
    }
  }

  if (page < totalPages) {

    html += `
      <button
        onclick="search(${page + 1})"
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
function copySummary(btn) {

  navigator.clipboard.writeText(
    btn.dataset.copy
  );

  const original =
    btn.textContent;

  btn.textContent = "Copied";

  setTimeout(() => {

    btn.textContent =
      original;

  }, 1000);
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
    .forEach(cb => cb.checked = true);

  search(1);
}


// ====================================
// MOBILE SIDEBAR
// ====================================
const sidebar =
  document.getElementById("sidebar");

const overlay =
  document.getElementById(
    "sidebarOverlay"
  );

document
  .getElementById("mobileMenuBtn")
  .addEventListener("click", () => {

    sidebar.classList.add("open");

    overlay.classList.add("show");
  });


document
  .getElementById("closeSidebarBtn")
  .addEventListener("click", closeSidebar);

overlay.addEventListener(
  "click",
  closeSidebar
);


function closeSidebar() {

  sidebar.classList.remove("open");

  overlay.classList.remove("show");
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
  .querySelectorAll(".event_filter")
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
// FIRST LOAD
// ====================================
window.onload = () => {
  search(1);
};
