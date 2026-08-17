import React, { useMemo, useEffect } from 'react'
import Item from './item'
const List = ({languages, onSelect, selectedLanguage}) => {

    const createElements = () => {
        let elements = []
        for(let i = 0; i < languages.length; i++) {
            elements.push(
                <Item
                    key={i}
                    language={languages[i].fileName}
                    displayName={languages[i].displayName}
                    onClick={onSelect}
                    selectedLanguage={selectedLanguage}
                    editable={languages[i].editable}
                />
            )
        }
        return elements
    }
    return (
        <div className="listing">
            <div style={{ overflowY: 'auto' }}>
                {
                    createElements()
                }
            </div>
        </div>
    )
}

export default List;
