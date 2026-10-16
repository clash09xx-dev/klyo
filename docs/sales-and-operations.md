# Klyo: sprzedaż i realizacja

## Od szansy do rozliczenia

1. **Companies → Company details & departments**: uzupełnij NIP, adres, dane rejestrowe i własne pola. Dodaj oddział, a w nim działy. Kontakt, sprawa i oferta mogą wskazywać konkretną jednostkę.
2. **Commercial register → New case**: dodaj temat, osobę, firmę, produkty, termin ważności i warunki. Powstaje powiązana szansa w wybranym lejku. **Create offer** przygotowuje ofertę z tym samym numerem. Zapisanie zwykłej nowej oferty również tworzy wpis w rejestrze. Zwykły deal nie musi mieć wpisu.
3. **Quotes → Commercial settings & bundles**: zaznacz pozycje i nazwij zestaw. Opisy i SKU zostają, a klient widzi cenę zestawu. Przełącz **Client pricing** na **Only the offer total**, aby pokazać wyłącznie sumę. Nadal działają rabaty na pozycje i całą ofertę oraz własny projekt A4.
4. **Commercial register → Purchase prices**: właściciel importuje ceny zakupu z CSV/XLSX, dopasowując istniejące SKU. Waluta kosztu musi odpowiadać walucie oferty; brakujący koszt daje brak wyliczenia, a nie zerowy koszt. **Margin access** ustala dostęp pracowników i współczynnik prezentacji. Wewnętrzna analiza zawiera zysk, marżę i narzut; nie trafia do PDF klienta. Współczynnik nie zmienia rzeczywistych danych właściciela.
5. Po wygraniu sprawy otwórz **Create order / project**. Zamówienia klienta, wewnętrzne i dostawcy mają osobne etapy realizacji. Kwoty zamówienia są netto. Dla produktu z zaznaczonym **Serial required at sale** wprowadź jeden numer na każdą sztukę przed potwierdzeniem zamówienia klienta. Ten sam numer produktu nie może być przydzielony jednocześnie do dwóch aktywnych sprzedaży.
6. W zamówieniu uzupełnij uzgodnione ceny, datę dostawy, dane logistyczne, potwierdzenie odbioru i fakturę. W **Customize confirmation** wybierz zapisany szablon oferty (również własny projekt A4), styl, język, kolor, dane stron i treść. Pobierz **Customer confirmation PDF**. Zmienione ceny końcowe i płatność aktualizują rejestr. Fakturownia wymaga własnego konta i osobnego potwierdzenia wystawienia; po rezerwacji faktury dane finansowe zamówienia są blokowane.

## Raporty i zadania

**Overview** zawiera raport miesięczny filtrowany po walucie i osobie: plan, wygrana sprzedaż, procent realizacji, brakująca wartość oraz prognoza ważona. W **Deals → Edit** wpisz prawdopodobieństwo 0–100% i planowaną datę zamknięcia. Prognoza to suma wartości otwartych spraw razy ich prawdopodobieństwo w wybranym miesiącu. Wygrane są liczone według rzeczywistej daty zamknięcia. Waluty nie są dodawane do siebie. Właściciel widzi porównanie zarejestrowanych spotkań, rozmów i wysłanych ofert pracowników. Niżej jest wyraźnie oznaczone podsumowanie całego okresu.

**Deals → Table** pozwala zaznaczyć i eksportować wybrane sprawy. Podczas przeciągania karty tablicy pojawiają się pola **Won / Lost / Move to trash**. Przegrana wymaga powodu. Filtr **Deleted** udostępnia **Restore**. Kosz nie wchodzi do wyników ani prognozy.

**Tasks** ma listę, macierz pilności/ważności i Kanban. Dodawaj podzadania, kamienie milowe, przypisanie, termin i przypomnienie. Zmiana kwadrantu lub kolumny przeciągnięciem zapisuje właściwości zadania. Ikona przypomnień przy tytule widoku pokazuje przypisane Ci terminy; nie wysyła wiadomości do klientów.

## Projekty i wyposażenie

**Projects** obsługuje realizację, serwis, prezentacje i projekty wewnętrzne. Połącz projekt z wygraną sprawą, dodaj zadania, budżet i terminy. **Plan resources** zapisuje osoby i godziny planowane; **Log work** zapisuje czas rzeczywisty. W projekcie są powiązane zamówienia, sprzęt, uzgodnienia i dokumentacja oraz protokół PDF z miejscem na podpis odbiorcy. Eksport protokołu nie oznacza podpisania dokumentu.

**Equipment** zapisuje producenta, model, numer seryjny, zdjęcie inspekcyjne, stan techniczny i cykl kalibracji. Rezerwacja wskazuje osobę, projekt lub zadanie i okres. **Check out / Return** rejestruje wydanie, zwrot i stan. System blokuje kolidujące rezerwacje i drugie wydanie tego samego przyrządu. Data kalibracji tworzy powiązane zadanie; po kolejnej kalibracji termin jest przesuwany zgodnie z cyklem.

## Korespondencja, dokumenty i integracje

**Inbox** i **RFQ register** obsługują skrzynkę Microsoft 365, ręczne przypisywanie korespondencji oraz jawnie skonfigurowane reguły nowych zapytań z terminem reakcji. Nie są to automatyczne follow-upy. Skrzynka nieprzypisanych wiadomości pozostaje prywatna, a korespondencja przypisana do rekordu jest dostępna uprawnionym osobom w aktywnej przestrzeni.

Plik przypisany do sprawy widać również przy jej firmie i przypisanym kontakcie. Firma zbiera dokumenty swoich kontaktów, ofert, projektów i zamówień; inny kontakt z tej samej firmy nie otrzymuje automatycznie dokumentów obcej sprawy.

Konfiguracja kont Microsoft 365, Google Drive, Dropbox, Apollo i Fakturownia: [instrukcja integracji](communications-setup.md). SharePoint: [instrukcja SharePoint](sharepoint-setup.md). Bez danych dostawcy integracja pokazuje brak połączenia. Śledzenie przesyłek otwiera oficjalny portal przewoźnika; ta wersja nie pobiera statusów z płatnych API przewoźników ani nie implementuje KSeF.

## Team i Personal

Każdy moduł pracuje w aktywnej przestrzeni. **Copy from Team** tworzy niezależne kopie i pokazuje pomijane elementy przed kopiowaniem. Ponowne kopiowanie zachowuje prywatne edycje. Rezerwacje i wydania sprzętu, przypisania numerów seryjnych, historia faktur/płatności, pliki, połączenia, plany zasobów i czas pracowników nie są odtwarzane jako nowe zdarzenia. Zamówienia i oferty stają się szkicami. Koszty zakupu kopiuje tylko faktyczny właściciel źródłowego zespołu.
