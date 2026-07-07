package main

import (
	"database/sql"
	// "fmt"
	"log"
	"strconv"

	"github.com/biter777/countries"
	_ "github.com/lib/pq"
)

type Country struct {
	Name      string
	Iso2      string
	Iso3      string
	PhoneCode *string
	Currency  *string
}

func safeString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func main() {
	country_data := countries.All()
	// countries := []Country{}

	// connection string to connect the postgres server
	connStr := "host=localhost port=5433 user=postgres password=postgres123 dbname=magic-pages sslmode=disable"

	dbConn, err := sql.Open("postgres", connStr)

	if err == nil {
		log.Fatal(err)
	}

	defer dbConn.Close()

	// starting a transaction so everything goes soomthly
	tx, err := dbConn.Begin()

	if err != nil {
		log.Fatal(err)
	}

	statement, err := tx.Prepare(`
		INSERT INTO countries(iso2, iso3, name, pincode, currency)
		VALUES($1, $2, $3, $4, $5,)
		ON CONFLICT(iso2) DO NOTHING
	`)

	if err != nil {
		log.Fatal(err)
	}

	defer statement.Close()

	for _, c := range country_data {
		// getting the iso2 code and storing that into the struct
		iso2 := c.Alpha2()
		if iso2 == "" {
			continue
		}

		name := c.String()
		iso3 := c.Alpha3() // iso3 will always be their — so need to validation check

		var phoneCode *string
		codes := c.CallCodes()
		if len(codes) > 0 {
			// converting string into int64
			s := strconv.FormatInt(int64(codes[0]), 10)

			phoneCode = &s
		}

		var currency *string
		if cur := c.Currency().String(); cur != "" {
			currency = &cur
		}

		// here we will execute the transaction
		_, err := statement.Exec(
			iso2,
			iso3,
			name,
			safeString(phoneCode),
			safeString(currency),
		)

		if err != nil {
			log.Fatal(err)
		}

		// countries = append(countries, Country{
		// 	Name:      name,
		// 	Iso2:      iso2,
		// 	Iso3:      iso3,
		// 	PhoneCode: phoneCode,
		// 	Currency:  currency,
		// })
	}

	// c := countries[0]

	// fmt.Println(
	// 	c.Name,
	// 	c.Iso2,
	// 	c.Iso3,
	// 	safeString(c.Currency),
	// 	safeString(c.PhoneCode),
	// )
}
