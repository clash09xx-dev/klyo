# Klyo: sprzedaż i realizacja

## Od szansy do rozliczenia

1. **Companies → Company details & departments**: uzupełnij NIP, adres, dane rejestrowe i własne pola. Dodaj oddział, a w nim działy. Kontakt, sprawa i oferta mogą wskazywać konkretną jednostkę.
2. **Commercial register → New case**: dodaj temat, osobę, firmę, produkty, termin ważności i warunki. Powstaje powiązana szansa w wybranym lejku. **Create offer** przygotowuje ofertę z tym samym numerem. Zapisanie zwykłej nowej oferty również tworzy wpis w rejestrze. Zwykły deal nie musi mieć wpisu.
3. **Quotes → Commercial settings & bundles**: zaznacz pozycje i nazwij zestaw. Opisy i SKU zostają, a klient widzi cenę zestawu. Przełącz **Client pricing** na **Only the offer total**, aby pokazać wyłącznie sumę. Nadal działają rabaty na pozycje i całą ofertę oraz własny projekt A4.
4. **Commercial register → Purchase prices**: właściciel importuje ceny zakupu z CSV/XLSX, dopasowując istniejące SKU. Waluta kosztu musi odpowiadać walucie oferty; brakujący koszt daje brak wyliczenia, a nie zerowy koszt. **Margin access** ustala dostęp pracowników i współczynnik prezentacji. Wewnętrzna analiza zawiera zysk, marżę i narzut; nie trafia do PDF klienta. Współczynnik nie zmienia rzeczywistych danych właściciela.
5. Wygranie sprawy automatycznie tworzy jeden projekt realizacji. Istniejący projekt jest używany ponownie; ponowne otwarcie i wygranie nie tworzy duplikatu. Właściciel może wyłączyć tę opcję w **Projects → Project settings**. Dotyczy to przyszłych wygranych; stare wygrane nie są uzupełniane wstecz. Przycisk **Create order / project** pozostaje dostępny. Zamówienia klienta, wewnętrzne i dostawcy mają osobne etapy realizacji. Kwoty zamówienia są netto. Dla produktu z zaznaczonym **Serial required at sale** wprowadź jeden numer na każdą sztukę przed potwierdzeniem zamówienia klienta. Ten sam numer produktu nie może być przydzielony jednocześnie do dwóch aktywnych sprzedaży.
6. W zamówieniu uzupełnij uzgodnione ceny, datę dostawy, dane logistyczne, potwierdzenie odbioru i fakturę. W **Customize confirmation** wybierz zapisany szablon oferty (również własny projekt A4), styl, język, kolor, dane stron i treść. Pobierz **Customer confirmation PDF**. Zmienione ceny końcowe i płatność aktualizują rejestr. Fakturownia wymaga własnego konta i osobnego potwierdzenia wystawienia; po rezerwacji faktury dane finansowe zamówienia są blokowane.

## Raporty i zadania

**Overview** zawiera raport miesięczny filtrowany po walucie i osobie: plan, wygrana sprzedaż, procent realizacji, brakująca wartość oraz prognoza ważona. W **Deals → Edit** wpisz prawdopodobieństwo 0–100% i planowaną datę zamknięcia. Prognoza to suma wartości otwartych spraw razy ich prawdopodobieństwo w wybranym miesiącu. Wygrane są liczone według rzeczywistej daty zamknięcia. Waluty nie są dodawane do siebie. Właściciel widzi porównanie zarejestrowanych spotkań, rozmów i wysłanych ofert pracowników. Niżej jest wyraźnie oznaczone podsumowanie całego okresu.

Raport można dodatkowo filtrować po lejku. **Sales scorecard → Set benchmarks** ustawia miesięczny cel wartości nowych szans, liczby spotkań, skuteczności oraz próg zastoju w etapie (1–365 dni). Są to własne cele użytkownika, a nie deklarowane średnie rynkowe. Cele dotyczą osoby lub całej przestrzeni, miesiąca i waluty, łącznie dla lejków. Filtr lejka zawęża szanse; aktywność spotkań nadal dotyczy osoby i miesiąca. Kolory pokazują realizację wyłącznie zdefiniowanych celów. Brak celu lub danych daje brak porównania, a nie wymyślony wynik.

Wykres **Forecast vs target** zestawia wygrane i ważone otwarte szanse z planem na sześć miesięcy. To szacunek oparty na wpisanym prawdopodobieństwie, bez fikcyjnego przedziału pewności. **Created vs closed opportunities** pokazuje dzienne liczby spraw, a **Opportunity value by source** wartości spraw utworzonych w miesiącu według pola **Source**. **Closing in the next 30 days** i **Pipeline health** prowadzą do konkretnych spraw: brak daty/wartości, zerowe prawdopodobieństwo, przeterminowane zamknięcie lub zadanie oraz zastój w etapie. Dla historycznego miesiąca stan uwagi jest liczony na jego koniec, a dla bieżącego na dziś. To analiza obecnych rekordów, nie archiwalne migawki ich stanu. Właściciel ma dodatkowo wyniki sprzedaży osób.

**Deals → Table** pozwala zaznaczyć i eksportować wybrane sprawy. Podczas przeciągania karty tablicy pojawiają się pola **Won / Lost / Move to trash**. Przegrana wymaga powodu. Filtr **Deleted** udostępnia **Restore**. Kosz nie wchodzi do wyników ani prognozy.

**Tasks** ma listę, macierz pilności/ważności i Kanban. Dodawaj podzadania, kamienie milowe, przypisanie, termin i przypomnienie. Zmiana kwadrantu lub kolumny przeciągnięciem zapisuje właściwości zadania. Ikona przypomnień przy tytule widoku pokazuje przypisane Ci terminy; nie wysyła wiadomości do klientów.

Nowe zadania wymagają poprawnej daty wykonania zarówno w formularzu, jak i API. Istniejącego terminu nie można wyczyścić. Starsze zadania bez terminu nadal można oznaczać jako wykonane; pełna edycja wymaga uzupełnienia daty.

## Projekty i wyposażenie

**Projects** obsługuje realizację, serwis, prezentacje i projekty wewnętrzne. Połącz projekt z wygraną sprawą, dodaj zadania, budżet i terminy. **Plan resources** zapisuje osoby i godziny planowane; **Log work** zapisuje czas rzeczywisty. W projekcie są powiązane zamówienia, sprzęt, uzgodnienia i dokumentacja oraz protokół PDF z miejscem na podpis odbiorcy. Eksport protokołu nie oznacza podpisania dokumentu.

**Project → Settlement** jest dostępne właścicielowi przestrzeni. Pokazuje sprzedaż netto z potwierdzonych zamówień klienta, zakupy z zamówień dostawcy, koszt pracy, inne koszty, otrzymane wpłaty, należności, zysk i marżę. Szkice i anulowane zamówienia są pomijane; zamówienia wewnętrzne nie dublują zakupów. Waluty są rozdzielone bez automatycznej konwersji. Budżet jest osobną informacją, nie przychodem. Koszt godzinowy wpisuje właściciel w planie osób; zapis czasu utrwala stawkę w walucie projektu. Zmiana planu nie przelicza starej pracy. Po zapisaniu czasu lub stawek waluta projektu jest zablokowana, aby nie zmieniać znaczenia kosztów. Właściciel może poprawić poszczególne zapisane stawki w rozliczeniu. Gdy brakuje kosztu choć części godzin, zysk i łączny koszt są oznaczone jako niepełne, zamiast traktować pracę jako darmową. **Add expense** dodaje opis, datę, walutę i kwotę pozostałego kosztu. To operacyjne rozliczenie netto, nie księgowość ani saldo bankowe.

**Commercial register** pokazuje NIP, adres, dane kontaktowe oraz warunki płatności i dostawy bez otwierania edytora. Szeroka tabela przewija się wewnątrz widoku i zachowuje numer sprawy przy lewej krawędzi. W edytorze oferty **Internal margin analysis** otwiera panel po prawej stronie na całą wysokość ekranu. Kliknięcie jego nagłówka lub Escape zamyka panel, zachowując edytowaną ofertę. Marża nie jest dodawana do PDF klienta.

**Equipment** zapisuje producenta, model, numer seryjny, zdjęcie inspekcyjne, stan techniczny i cykl kalibracji. Rezerwacja wskazuje osobę, projekt lub zadanie i okres. **Check out / Return** rejestruje wydanie, zwrot i stan. System blokuje kolidujące rezerwacje i drugie wydanie tego samego przyrządu. Data kalibracji tworzy powiązane zadanie; po kolejnej kalibracji termin jest przesuwany zgodnie z cyklem.

## Korespondencja, dokumenty i integracje

**Inbox** i **RFQ register** obsługują skrzynkę Microsoft 365, ręczne przypisywanie korespondencji oraz jawnie skonfigurowane reguły nowych zapytań z terminem reakcji. Nie są to automatyczne follow-upy. Skrzynka nieprzypisanych wiadomości pozostaje prywatna, a korespondencja przypisana do rekordu jest dostępna uprawnionym osobom w aktywnej przestrzeni.

Plik przypisany do sprawy widać również przy jej firmie i przypisanym kontakcie. Firma zbiera dokumenty swoich kontaktów, ofert, projektów i zamówień; inny kontakt z tej samej firmy nie otrzymuje automatycznie dokumentów obcej sprawy.

Konfiguracja kont Microsoft 365, Google Drive, Dropbox, Apollo i Fakturownia: [instrukcja integracji](communications-setup.md). SharePoint: [instrukcja SharePoint](sharepoint-setup.md). Bez danych dostawcy integracja pokazuje brak połączenia. Microsoft 365 obsługuje również uprawnione skrzynki współdzielone przez **Shared mailbox** po zgodzie `Mail.Read.Shared`. Statusy DHL można pobrać w **Order → Shipment status** po dodaniu własnego klucza API DHL przez właściciela. Pozostali przewoźnicy nadal mają oficjalne portale śledzenia. Ta wersja nie implementuje KSeF.

Etykiety nowych modułów sprzedaży, projektów, zadań i integracji są dostępne w PL/EN/ES/FR/DE. Zmiana języka nie tłumaczy danych wpisanych przez użytkowników ani treści wiadomości i odpowiedzi dostawców.

## Team i Personal

Każdy moduł pracuje w aktywnej przestrzeni. **Copy from Team** tworzy niezależne kopie i pokazuje pomijane elementy przed kopiowaniem. Ponowne kopiowanie zachowuje prywatne edycje. Rezerwacje i wydania sprzętu, przypisania numerów seryjnych, historia faktur/płatności, pliki, połączenia, plany zasobów i czas pracowników nie są odtwarzane jako nowe zdarzenia. Zamówienia i oferty stają się szkicami. Koszty zakupu kopiuje tylko faktyczny właściciel źródłowego zespołu.
