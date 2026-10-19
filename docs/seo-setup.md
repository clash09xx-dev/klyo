# Klyo Labs — indeksowanie i Search Console

Publiczna domena kanoniczna: **https://klyolabs.com**. Nazwa serwisu: **Klyo Labs**; nazwa produktu: **Klyo CRM**. Nie trzeba zmieniać nazwy aplikacji OAuth ani jej adresów callback.

## Jednorazowo po stronie właściciela

1. Otwórz [Google Search Console](https://search.google.com/search-console) na swoim koncie Google. Jeśli `klyolabs.com` jest już na liście usług, wybierz tę usługę.
2. Jeżeli nie ma jej na liście, wybierz **Dodaj usługę → Prefiks adresu URL** i wpisz dokładnie `https://klyolabs.com`.
3. Weryfikacja: wybierz **Tag HTML**. Z podanego tagu skopiuj samą wartość `content`, bez cudzysłowów i bez całego elementu `<meta>`.
4. W Railway, w zmiennych serwisu Klyo, dodaj `GOOGLE_SITE_VERIFICATION` z tą wartością i zastosuj zmiany. Serwer doda tag do publicznych stron. To publiczny token własności, a nie klucz API Google Calendar. Nie zmieniaj istniejących `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. Wróć do Search Console i kliknij **Zweryfikuj**. Alternatywnie możesz zweryfikować usługę domenową przez wpis DNS TXT zgodny z instrukcją Google; kod witryny nie jest wtedy potrzebny.
6. **Mapy witryn → Dodaj nową mapę witryny:** `https://klyolabs.com/sitemap.xml`.
7. W **Sprawdzeniu adresu URL** sprawdź kolejno stronę główną, `/pl`, `/pdf-quotes`, `/pl/oferty-pdf` i `/pricing`. Użyj **Testuj opublikowany URL**, a następnie **Poproś o zindeksowanie**, jeśli Google udostępnia tę opcję.

Mapa obejmuje 14 stron produktowych w parach EN/PL oraz publiczne warunki i politykę prywatności. Istniejące podstrony `.html`, starsze `/customization` i końcowe ukośniki przekierowują na preferowane adresy. Nieistniejące strony zwracają rzeczywisty kod 404. Aplikacja, logowanie, API i publiczne linki do ofert otrzymują nagłówki wyłączające indeksowanie. Te nagłówki nie zastępują istniejących zabezpieczeń dostępu.

## Co sprawdzić w Search Console

- **Indeksowanie → Strony:** czy adres jest zaindeksowany, jaka jest ostatnia data odczytu oraz który URL Google wybrał jako kanoniczny. Sam wynik `site:` nie jest pełnym raportem indeksowania.
- **Skuteczność → Wyniki wyszukiwania:** zapytania `Klyo Labs`, `Klyo CRM`, `CRM oferty PDF` oraz wejścia na konkretne strony. Uwzględnij kraj i urządzenie.
- **Mapy witryn:** czy mapa została pobrana i przetworzona bez błędów.
- **Podstawowe wskaźniki internetowe:** dane rzeczywistych użytkowników pojawiają się dopiero po zebraniu wystarczającego ruchu. Jednorazowy Lighthouse jest testem laboratoryjnym.

Google sam decyduje o ponownym odczycie, indeksowaniu i pozycji. Zgłoszenie mapy ani prośba o indeksowanie nie gwarantują konkretnego terminu lub pierwszego miejsca. Po zmianach warto oceniać raporty na przestrzeni kolejnych tygodni.

## Utrzymanie

- `server/content/publicPages.js` definiuje prawdziwe treści i pary językowe. Obie wersje mają własny kanoniczny adres oraz wzajemne odnośniki `hreflang`.
- `server/config/tiers.js` pozostaje jedynym źródłem cen dla widocznego cennika, API i danych strukturalnych. Testy sprawdzają ich zgodność. Nie wpisuj osobnych cen w tekście marketingowym.
- `server/services/publicSite.js` renderuje tę samą treść dla ludzi i robotów; cena nie zależy od JavaScriptu. Nową publiczną stronę dodaj też do nawigacji, a statyczną kopię mapy odśwież poleceniem `node -e "require('fs').writeFileSync('public/sitemap.xml',require('./server/services/publicSite').sitemap())"`.
- Aktualizuj zrzuty ekranów i opisy, kiedy zmienia się produkt. Dane demonstracyjne pozostają oznaczone jako przykładowe.
- Opcjonalnie `BING_SITE_VERIFICATION` obsługuje token własności Bing Webmaster Tools. Zgłoszenie mapy w tym narzędziu wykonuje właściciel konta.

Oficjalne instrukcje: [nazwy witryn](https://developers.google.com/search/docs/appearance/site-names), [mapy witryn](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [wersje językowe](https://developers.google.com/search/docs/specialty/international/localized-versions), [podstawy SEO](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).


## Audyt 19 października 2026

Potwierdzono: 16 adresów mapy odpowiada 200, treści produktowe są renderowane
na serwerze, a 14 stron EN/PL ma własne canonicale i wzajemne hreflang.
Poradniki `/docs/...html` przekierowują na `/docs/...`; także końcowe ukośniki
i wielkie litery na stronach prawnych są normalizowane. Logowanie ma zgodne
meta i nagłówki noindex. Tytuł Make It Yours zawiera kategorię Customizable CRM.
Na stronie ofert są prawdziwe przykładowe PDF-y z oznaczeniem fikcyjnych danych.
Cennik wyjaśnia automatyczne odnowienie i anulowanie. Nie dodano wymyślonych
opinii, ocen, wolumenów słów ani danych firmy.

`www.klyolabs.com` było nieobecne w DNS. Domena jest przygotowana w Railway;
rekordy CNAME i TXT należy dodać u dostawcy DNS według bieżącego
`railway domain status www.klyolabs.com`. Po weryfikacji adres ma przekierowywać
301 na główną domenę, zachowując ścieżkę i parametry. Nie zmieniać rekordu `@`,
poczty ani istniejących rekordów weryfikacji Google.

Pełny raport, dowody HTTP i obrazy przeglądarek zapisano w artefaktach zadania
`artifacts/seo-audit-20261019`. Badanie korzystało z metodyki Claude SEO 2.4.2
(commit `4b99de2f7de7e7d5247042e5fb5b4ea9368ef734`); model Claude nie był
zalogowany, a jego samodzielny runtime nie był gotowy. Dane pozyskano naszymi
narzędziami HTTP i Playwright. PageSpeed API zwróciło limit 429; nie raportujemy
wyniku Lighthouse ani spełnienia Core Web Vitals. Nie było dostępu API do GSC,
GA4 ani zewnętrznej bazy backlinków. Podstawowe raporty GSC odczytano ręcznie
w zalogowanym panelu i zapisano lokalnie w raporcie audytu. Do dalszej oceny
potrzebne są aktualne inspekcje konkretnych podstron oraz podział na kraje;
starszego raportu indeksacji nie należy utożsamiać z dzisiejszym testem strony.
