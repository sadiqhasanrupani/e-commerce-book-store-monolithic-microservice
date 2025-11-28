#!/bin/bash

# --- Formatting Colors ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# --- Functions ---

function generate_identity() {
  echo -e "${BLUE}🔄 Generating new random identity...${NC}"

  # Run auth and capture output
  AUTH_OUTPUT=$(mailtm auth random 2>&1)

  # Check if command failed
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error generating account. Check your internet connection.${NC}"
    return
  fi

  # Extract email (Assuming format: "| Email : user@domain.com |")
  CURRENT_EMAIL=$(echo "$AUTH_OUTPUT" | grep "Email" | awk '{print $4}')

  echo -e "${GREEN}✅ Success! New identity created.${NC}"
  echo "------------------------------------------"
  echo -e "📧 Email: ${YELLOW}$CURRENT_EMAIL${NC}"
  echo "------------------------------------------"
}

function check_inbox() {
  echo -e "${BLUE}🔄 Checking inbox...${NC}"

  # Get message list
  LIST_OUTPUT=$(mailtm message list 2>&1)

  # Count lines. Header + Separator = 2 lines. Anything > 2 is a message.
  LINE_COUNT=$(echo "$LIST_OUTPUT" | wc -l)

  if [ "$LINE_COUNT" -le 2 ]; then
    echo -e "${YELLOW}📭 Inbox is empty.${NC}"
  else
    echo -e "${GREEN}start📬 Message found!${NC}"

    # Display the list summary (skipping the separator line if desired, or just show all)
    # We strip the first 2 lines to get clean data for the ID
    RAW_DATA=$(echo "$LIST_OUTPUT" | tail -n +3)

    # Get the newest message ID (first item in the list)
    LATEST_ID=$(echo "$RAW_DATA" | head -n 1 | awk '{print $1}')
    SENDER=$(echo "$RAW_DATA" | head -n 1 | awk -F'|' '{print $4}' | xargs)
    SUBJECT=$(echo "$RAW_DATA" | head -n 1 | awk -F'|' '{print $3}' | xargs)

    echo -e "From: $SENDER"
    echo -e "Subject: $SUBJECT"
    echo "------------------------------------------"
    echo -e "${BLUE}Downloading content...${NC}"
    echo ""

    # Fetch the full body of the latest message
    mailtm message get "$LATEST_ID"
    echo ""
    echo "------------------------------------------"
  fi
}

# --- Main Menu Loop ---

while true; do
  echo ""
  echo -e "${BLUE}--- MailTM Controller ---${NC}"
  echo "1. 🆕 Generate New Random Email"
  echo "2. 📩 Check Inbox (Fetch Latest)"
  echo "3. 🚪 Exit"
  echo -n "Select an option [1-3]: "
  read choice

  case $choice in
  1)
    generate_identity
    ;;
  2)
    check_inbox
    ;;
  3)
    echo "Bye!"
    exit 0
    ;;
  *)
    echo -e "${RED}Invalid option.${NC}"
    ;;
  esac
done
